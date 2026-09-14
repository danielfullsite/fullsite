// Fullsite Fingerprint Service — multi-tenant
// Compile: C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /r:DPUruNet.dll /out:fingerprint-service.exe fingerprint-service.cs
// Prerequisites: DPUruNet.dll in the same directory as the exe.
// Config: reads Electron userData first, then legacy C:\fullsite\config.json.
//
// Endpoints:
//   GET  /health                → reader status + enrolled count
//   GET  /enroll?id=STAFF_ID   → 4-sample enrollment, saves template locally + Supabase
//   GET  /identify              → 1-sample 1:N match, returns staffId
//   GET  /list                  → enrolled staff IDs
//   GET  /delete?id=STAFF_ID   → delete locally + from Supabase
// Every endpoint uses mutual HMAC authentication. The shared secret never
// crosses the HTTP socket; request and response are bound to one fresh nonce.

using System;
using System.IO;
using System.Net;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Collections.Generic;
using DPUruNet;

class FingerprintService
{
    static Reader reader;
    static readonly object templatesLock = new object();
    static Dictionary<string, Fmd> templates = new Dictionary<string, Fmd>(StringComparer.Ordinal);
    static string templatesDir = @"C:\fullsite\fingerprints";
    const int DPFJ_PROBABILITY_ONE = 0x7FFFFFFF;
    const int FALSE_POSITIVE_RATE = DPFJ_PROBABILITY_ONE / 100000;

    // Loaded from a validated config.json — never hardcoded
    static string supabaseUrl = "";
    static string supabaseKey = "";
    static string clientId    = "";
    // Sync de templates vía el SERVIDOR (el service_role NO vive en la caja).
    static string apiBaseUrl  = "https://app.fullsite.mx";
    static string syncSecret  = "";
    const string IpcSecretEnvironment = "FULLSITE_FINGERPRINT_IPC_SECRET";
    const string IpcTimestampHeader = "X-Fullsite-Fingerprint-Timestamp";
    const string IpcNonceHeader = "X-Fullsite-Fingerprint-Nonce";
    const string IpcSignatureHeader = "X-Fullsite-Fingerprint-Signature";
    const string IpcResponseSignatureHeader = "X-Fullsite-Fingerprint-Response-Signature";
    const string IpcAuthVersion = "fullsite-fingerprint-hmac-v1";
    const long IpcMaxClockSkewMs = 30000;
    const int MaxRequestBodyBytes = 1024 * 1024;
    static string ipcSecret = "";
    static readonly object nonceLock = new object();
    static readonly Dictionary<string, long> seenNonces = new Dictionary<string, long>(StringComparer.Ordinal);

    sealed class IpcRequestAuth
    {
        public string Timestamp;
        public string Nonce;
        public string Method;
        public string Path;
    }

    static void Main(string[] args)
    {
        System.Net.ServicePointManager.SecurityProtocol = System.Net.SecurityProtocolType.Tls12;

        Console.WriteLine("Fullsite Fingerprint Service");
        Console.WriteLine("============================");

        if (!LoadConfig() || !LoadIpcSecret())
        {
            Console.WriteLine("FATAL: configuración o secreto IPC de huella inválido");
            return;
        }
        Console.WriteLine("Config: client_id=" + clientId);

        if (!Directory.Exists(templatesDir))
            Directory.CreateDirectory(templatesDir);

        LoadTemplates();

        ThreadPool.QueueUserWorkItem(_ => {
            Dictionary<string, Fmd> snap;
            lock (templatesLock) { snap = new Dictionary<string, Fmd>(templates); }
            foreach (var kv in snap) SyncToSupabase(kv.Key, kv.Value);
            SyncFromSupabase();
        });

        if (!OpenReader())
        {
            Console.WriteLine("ERROR: No se encontro lector de huella digital");
            Console.WriteLine("Presiona Enter para salir...");
            Console.ReadLine();
            return;
        }

        Console.WriteLine("Lector: " + reader.Description.Name);
        Console.WriteLine("Serial: " + reader.Description.SerialNumber);

        HttpListener listener = new HttpListener();
        listener.Prefixes.Add("http://127.0.0.1:7718/");
        try
        {
            listener.Start();
        }
        catch (Exception e)
        {
            Console.WriteLine("ERROR al iniciar servidor HTTP: " + e.Message);
            Console.WriteLine("Ejecuta como administrador o verifica que el puerto 7718 este libre");
            Console.ReadLine();
            return;
        }

        int count;
        lock (templatesLock) { count = templates.Count; }
        Console.WriteLine("Servicio en http://127.0.0.1:7718");
        Console.WriteLine("Templates cargados: " + count);
        Console.WriteLine("Esperando solicitudes...\n");

        while (true)
        {
            try
            {
                HttpListenerContext ctx = listener.GetContext();
                ThreadPool.QueueUserWorkItem(_ => HandleRequest(ctx));
            }
            catch (Exception e)
            {
                Console.WriteLine("Error en listener: " + e.Message);
            }
        }
    }

    // ── Config loading ──────────────────────────────────────────────────────
    // Reads restaurant_id / supabaseUrl / supabaseAnonKey from config.json.
    // Accepts both new schema (snake_case) and legacy camelCase keys.

    static string[] UserDataCandidates()
    {
        string explicitDirectory = Environment.GetEnvironmentVariable("FULLSITE_USER_DATA_DIR") ?? "";
        string roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        return new string[] {
            explicitDirectory,
            Path.Combine(roaming, "fullsite-pos"),
            Path.Combine(roaming, "Fullsite POS"),
        };
    }

    static bool LoadConfig()
    {
        // Electron es la autoridad sobre userData. Cuando él arranca este hijo pasa
        // FULLSITE_USER_DATA_DIR; los dos nombres de Roaming conservan compatibilidad
        // con instalaciones existentes. C:\fullsite queda al final como migración.
        // Nunca se imprime el JSON ni una llave: sólo la ruta elegida y faltantes.
        List<string> candidates = new List<string>();
        foreach (string directory in UserDataCandidates())
        {
            if (!string.IsNullOrEmpty(directory)) candidates.Add(Path.Combine(directory, "config.json"));
        }
        candidates.Add(@"C:\fullsite\config.json");

        HashSet<string> visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (string configPath in candidates)
        {
            if (!visited.Add(configPath)) continue;
            try
            {
                if (!File.Exists(configPath)) continue;
                string json = File.ReadAllText(configPath, Encoding.UTF8);
                string rid = ExtractJsonString(json, "restaurant_id") ?? ExtractJsonString(json, "restaurantId") ??
                    ExtractJsonString(json, "client_id") ?? ExtractJsonString(json, "clientId");
                string url = ExtractJsonString(json, "supabaseUrl");
                string key = ExtractJsonString(json, "supabaseAnonKey");
                if (string.IsNullOrEmpty(rid) || string.IsNullOrEmpty(url) || string.IsNullOrEmpty(key))
                {
                    Console.WriteLine("config.json ignorado (incompleto): " + configPath);
                    continue;
                }

                clientId = rid.ToLowerInvariant().Trim();
                supabaseUrl = url.TrimEnd('/');
                supabaseKey = key;
                string api = ExtractJsonString(json, "apiBaseUrl") ?? ExtractJsonString(json, "api_base_url");
                if (!string.IsNullOrEmpty(api)) apiBaseUrl = api.TrimEnd('/');
                syncSecret = ExtractJsonString(json, "fingerprintSyncSecret") ?? ExtractJsonString(json, "fingerprint_sync_secret") ?? "";
                Console.WriteLine("Configuración de huella cargada desde " + configPath);
                return true;
            }
            catch (Exception e)
            {
                Console.WriteLine("config.json ignorado (no se pudo leer): " + configPath + " (" + e.GetType().Name + ")");
            }
        }
        Console.WriteLine("FATAL: no se encontró un config.json válido en userData ni en C:\\fullsite");
        return false;
    }

    static bool LoadIpcSecret()
    {
        try
        {
            string value = Environment.GetEnvironmentVariable(IpcSecretEnvironment) ?? "";
            if (string.IsNullOrEmpty(value))
            {
                foreach (string directory in UserDataCandidates())
                {
                    if (string.IsNullOrEmpty(directory)) continue;
                    string file = Path.Combine(directory, @"fingerprint\fingerprint-ipc-secret");
                    if (!File.Exists(file)) continue;
                    value = File.ReadAllText(file, Encoding.ASCII).Trim();
                    if (!string.IsNullOrEmpty(value)) break;
                }
            }
            if (!Regex.IsMatch(value, "^[a-f0-9]{64}$"))
            {
                Console.WriteLine("FATAL: falta el fingerprint-ipc-secret privado; actualiza/repara la instalación");
                return false;
            }
            ipcSecret = value;
            return true;
        }
        catch (Exception e)
        {
            Console.WriteLine("FATAL: no se pudo leer el secreto IPC: " + e.Message);
            return false;
        }
    }

    static bool ConstantTimeEquals(string presented, string expected)
    {
        byte[] a = Encoding.UTF8.GetBytes(presented ?? "");
        byte[] b = Encoding.UTF8.GetBytes(expected ?? "");
        int different = a.Length ^ b.Length;
        int length = Math.Max(a.Length, b.Length);
        for (int i = 0; i < length; i++)
        {
            byte av = i < a.Length ? a[i] : (byte)0;
            byte bv = i < b.Length ? b[i] : (byte)0;
            different |= av ^ bv;
        }
        return different == 0;
    }

    static byte[] HexBytes(string hex)
    {
        byte[] bytes = new byte[hex.Length / 2];
        for (int i = 0; i < bytes.Length; i++) bytes[i] = Convert.ToByte(hex.Substring(i * 2, 2), 16);
        return bytes;
    }

    static string Sha256Hex(byte[] bytes)
    {
        using (var sha = SHA256.Create()) return BytesToHex(sha.ComputeHash(bytes ?? new byte[0]));
    }

    static string BytesToHex(byte[] bytes)
    {
        var result = new StringBuilder(bytes.Length * 2);
        foreach (byte value in bytes) result.Append(value.ToString("x2", CultureInfo.InvariantCulture));
        return result.ToString();
    }

    static string HmacHex(string canonical)
    {
        using (var hmac = new HMACSHA256(HexBytes(ipcSecret)))
            return BytesToHex(hmac.ComputeHash(Encoding.UTF8.GetBytes(canonical)));
    }

    static long UnixTimeMilliseconds()
    {
        return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
    }

    static byte[] ReadRequestBody(HttpListenerRequest req)
    {
        if (req.ContentLength64 > MaxRequestBodyBytes) throw new InvalidOperationException("Cuerpo IPC demasiado grande");
        using (var output = new MemoryStream())
        {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = req.InputStream.Read(buffer, 0, buffer.Length)) > 0)
            {
                if (output.Length + read > MaxRequestBodyBytes) throw new InvalidOperationException("Cuerpo IPC demasiado grande");
                output.Write(buffer, 0, read);
            }
            return output.ToArray();
        }
    }

    static string RequestCanonical(IpcRequestAuth auth, byte[] body)
    {
        return string.Join("\n", new string[] {
            IpcAuthVersion, auth.Timestamp, auth.Nonce, auth.Method, auth.Path, Sha256Hex(body)
        });
    }

    static string ResponseCanonical(IpcRequestAuth auth, int statusCode, string body)
    {
        return string.Join("\n", new string[] {
            IpcAuthVersion + "-response", auth.Timestamp, auth.Nonce, auth.Method, auth.Path,
            statusCode.ToString(CultureInfo.InvariantCulture), Sha256Hex(Encoding.UTF8.GetBytes(body ?? ""))
        });
    }

    static bool RequireIpcAuth(HttpListenerRequest req, byte[] body, HttpListenerResponse res, out string json, out IpcRequestAuth auth)
    {
        json = "";
        auth = null;
        string timestamp = req.Headers[IpcTimestampHeader] ?? "";
        string nonce = req.Headers[IpcNonceHeader] ?? "";
        string presented = req.Headers[IpcSignatureHeader] ?? "";
        long timestampValue;
        long now = UnixTimeMilliseconds();
        if (!long.TryParse(timestamp, NumberStyles.None, CultureInfo.InvariantCulture, out timestampValue) ||
            timestampValue < now - IpcMaxClockSkewMs || timestampValue > now + IpcMaxClockSkewMs ||
            !Regex.IsMatch(nonce, "^[a-f0-9]{64}$") || !Regex.IsMatch(presented, "^[a-f0-9]{64}$"))
        {
            res.StatusCode = 401;
            json = "{\"ok\":false,\"error\":\"Autorización local requerida\",\"code\":\"FINGERPRINT_IPC_AUTH_INVALID\"}";
            return false;
        }

        var candidate = new IpcRequestAuth {
            Timestamp = timestamp,
            Nonce = nonce,
            Method = (req.HttpMethod ?? "").ToUpperInvariant(),
            Path = req.RawUrl ?? req.Url.PathAndQuery
        };
        string expected = HmacHex(RequestCanonical(candidate, body));
        if (!ConstantTimeEquals(presented, expected))
        {
            res.StatusCode = 401;
            json = "{\"ok\":false,\"error\":\"Autorización local requerida\",\"code\":\"FINGERPRINT_IPC_AUTH_INVALID\"}";
            return false;
        }

        // A valid signature proves Pedro knows the secret. Only after that do we
        // consume the nonce, so unauthenticated noise cannot exhaust the cache.
        auth = candidate;
        lock (nonceLock)
        {
            var expired = new List<string>();
            foreach (var item in seenNonces) if (item.Value < now - IpcMaxClockSkewMs) expired.Add(item.Key);
            foreach (string oldNonce in expired) seenNonces.Remove(oldNonce);
            if (seenNonces.ContainsKey(nonce))
            {
                res.StatusCode = 409;
                json = "{\"ok\":false,\"error\":\"Solicitud biométrica repetida\",\"code\":\"FINGERPRINT_IPC_REPLAY\"}";
                return false;
            }
            seenNonces[nonce] = timestampValue;
        }
        return true;
    }

    // Extract a JSON string value by key, handling escape sequences.
    static string ExtractJsonString(string json, string key)
    {
        string pattern = "\"" + key + "\"";
        int ki = json.IndexOf(pattern, StringComparison.Ordinal);
        if (ki < 0) return null;
        int ci = json.IndexOf(':', ki + pattern.Length);
        if (ci < 0) return null;
        int vi = ci + 1;
        while (vi < json.Length && json[vi] == ' ') vi++;
        if (vi >= json.Length || json[vi] != '"') return null;
        vi++;
        var sb = new StringBuilder();
        while (vi < json.Length)
        {
            char c = json[vi];
            if (c == '\\' && vi + 1 < json.Length)
            {
                vi++;
                switch (json[vi])
                {
                    case '"':  sb.Append('"');  break;
                    case '\\': sb.Append('\\'); break;
                    case '/':  sb.Append('/');  break;
                    case 'n':  sb.Append('\n'); break;
                    case 'r':  sb.Append('\r'); break;
                    case 't':  sb.Append('\t'); break;
                    default:   sb.Append(json[vi]); break;
                }
                vi++;
                continue;
            }
            if (c == '"') break;
            sb.Append(c);
            vi++;
        }
        return sb.ToString();
    }

    // ── Reader ──────────────────────────────────────────────────────────────

    static bool OpenReader()
    {
        try
        {
            ReaderCollection readers = ReaderCollection.GetReaders();
            if (readers == null || readers.Count == 0) return false;
            reader = readers[0];
            Constants.ResultCode rc = reader.Open(Constants.CapturePriority.DP_PRIORITY_EXCLUSIVE);
            if (rc != Constants.ResultCode.DP_SUCCESS) { Console.WriteLine("Error abriendo lector: " + rc); return false; }
            return true;
        }
        catch (Exception e) { Console.WriteLine("Error: " + e.Message); return false; }
    }

    // ── HTTP handler ────────────────────────────────────────────────────────

    static void HandleRequest(HttpListenerContext ctx)
    {
        var req = ctx.Request;
        var res = ctx.Response;
        string path    = req.Url.AbsolutePath;
        string staffId = req.QueryString["id"] ?? "";
        string json    = "";
        IpcRequestAuth auth = null;

        try
        {
            byte[] requestBody = ReadRequestBody(req);
            if (RequireIpcAuth(req, requestBody, res, out json, out auth))
            {
                if (!string.Equals(req.HttpMethod, "GET", StringComparison.OrdinalIgnoreCase))
                {
                    res.StatusCode = 405;
                    json = "{\"ok\":false,\"error\":\"Método no permitido\"}";
                }
                else switch (path)
                {
                    case "/health":
                        int cnt; lock (templatesLock) { cnt = templates.Count; }
                        json = "{\"ok\":true,\"ipc_auth_required\":true,\"ipc_auth_scheme\":\"hmac-sha256-v1\",\"reader\":\"" + EscapeJson(reader.Description.Name) + "\",\"enrolled\":" + cnt + ",\"client_id\":\"" + EscapeJson(clientId) + "\"}";
                        break;
                    case "/enroll":
                        if (string.IsNullOrEmpty(staffId)) { json = "{\"error\":\"Falta parametro id\"}"; res.StatusCode = 400; }
                        else json = DoEnroll(staffId);
                        break;
                    case "/identify":
                        json = DoIdentify();
                        break;
                    case "/list":
                        json = DoList();
                        break;
                    case "/delete":
                        if (string.IsNullOrEmpty(staffId)) { json = "{\"error\":\"Falta parametro id\"}"; res.StatusCode = 400; }
                        else json = DoDelete(staffId);
                        break;
                    default:
                        json = "{\"error\":\"Ruta no encontrada\"}"; res.StatusCode = 404;
                        break;
                }
            }
        }
        catch (Exception e)
        {
            json = "{\"error\":\"" + EscapeJson(e.Message) + "\"}";
            res.StatusCode = 500;
            Console.WriteLine("[ERROR] " + path + ": " + e.Message);
        }

        byte[] buf = Encoding.UTF8.GetBytes(json);
        if (auth != null) res.Headers.Add(IpcResponseSignatureHeader, HmacHex(ResponseCanonical(auth, res.StatusCode, json)));
        res.ContentType = "application/json; charset=utf-8";
        res.ContentLength64 = buf.Length;
        res.OutputStream.Write(buf, 0, buf.Length);
        res.Close();
    }

    // ── Enrollment ──────────────────────────────────────────────────────────

    static string DoEnroll(string staffId)
    {
        Console.WriteLine("[enroll] " + staffId + " — coloca el dedo 4 veces");
        var fmds = new List<Fmd>();
        for (int i = 0; i < 4; i++)
        {
            Console.WriteLine("[enroll] Captura " + (i + 1) + "/4...");
            Fmd fmd = CaptureFmd();
            if (fmd == null) return "{\"error\":\"Captura fallida en intento " + (i + 1) + ". Vuelve a intentar.\"}";
            fmds.Add(fmd);
            Console.WriteLine("[enroll] Captura " + (i + 1) + " OK");
            if (i < 3) { Console.WriteLine("[enroll] Quita el dedo..."); Thread.Sleep(2000); }
        }

        DataResult<Fmd> result = DPUruNet.Enrollment.CreateEnrollmentFmd(Constants.Formats.Fmd.ANSI, fmds);
        if (result == null || result.ResultCode != Constants.ResultCode.DP_SUCCESS)
            return "{\"error\":\"Error creando template: " + (result != null ? result.ResultCode.ToString() : "null") + "\"}";

        lock (templatesLock) { templates[staffId] = result.Data; }
        SaveTemplate(staffId, result.Data);
        ThreadPool.QueueUserWorkItem(_ => SyncToSupabase(staffId, result.Data));

        Console.WriteLine("[enroll] " + staffId + " registrado OK");
        return "{\"ok\":true,\"staffId\":\"" + EscapeJson(staffId) + "\"}";
    }

    // ── Identification ──────────────────────────────────────────────────────

    static string DoIdentify()
    {
        int cnt; lock (templatesLock) { cnt = templates.Count; }
        if (cnt == 0) return "{\"error\":\"No hay huellas registradas\"}";

        Console.WriteLine("[identify] Esperando huella...");
        Fmd fmd = CaptureFmd();
        if (fmd == null) return "{\"error\":\"No se pudo capturar la huella\"}";

        Dictionary<string, Fmd> snap;
        lock (templatesLock) { snap = new Dictionary<string, Fmd>(templates); }

        string bestMatch = null;
        int    bestScore = int.MaxValue;
        foreach (var kv in snap)
        {
            try
            {
                CompareResult r = Comparison.Compare(kv.Value, 0, fmd, 0);
                if (r.Score < FALSE_POSITIVE_RATE && r.Score < bestScore) { bestScore = r.Score; bestMatch = kv.Key; }
            }
            catch (Exception e) { Console.WriteLine("[identify] Error comparando " + kv.Key + ": " + e.Message); }
        }

        if (bestMatch != null)
        {
            Console.WriteLine("[identify] Match: " + bestMatch + " (score: " + bestScore + ")");
            return "{\"ok\":true,\"staffId\":\"" + EscapeJson(bestMatch) + "\",\"score\":" + bestScore + "}";
        }
        Console.WriteLine("[identify] Sin coincidencia");
        return "{\"ok\":false,\"error\":\"Huella no reconocida\"}";
    }

    // ── List ────────────────────────────────────────────────────────────────

    static string DoList()
    {
        List<string> keys;
        lock (templatesLock) { keys = new List<string>(templates.Keys); }
        var sb = new StringBuilder("{\"enrolled\":[");
        for (int i = 0; i < keys.Count; i++)
        {
            if (i > 0) sb.Append(',');
            sb.Append('"').Append(EscapeJson(keys[i])).Append('"');
        }
        sb.Append("],\"count\":").Append(keys.Count).Append('}');
        return sb.ToString();
    }

    // ── Delete ──────────────────────────────────────────────────────────────

    static string DoDelete(string staffId)
    {
        bool found;
        lock (templatesLock) { found = templates.Remove(staffId); }
        if (!found) return "{\"error\":\"No encontrado\",\"staffId\":\"" + EscapeJson(staffId) + "\"}";

        string filePath = Path.Combine(templatesDir, staffId + ".b64");
        try { if (File.Exists(filePath)) File.Delete(filePath); } catch {}
        ThreadPool.QueueUserWorkItem(_ => SyncDeleteFromSupabase(staffId));
        Console.WriteLine("[delete] " + staffId + " eliminado");
        return "{\"ok\":true}";
    }

    // ── Capture ─────────────────────────────────────────────────────────────

    static ManualResetEvent captureEvent = new ManualResetEvent(false);
    static CaptureResult lastCaptureResult;

    static void OnCaptured(CaptureResult result) { lastCaptureResult = result; captureEvent.Set(); }

    static Fmd CaptureFmd()
    {
        try
        {
            Console.WriteLine("[capture] Pon tu dedo en el lector (luz azul)...");
            try { reader.CancelCapture(); } catch {}
            Thread.Sleep(200);
            captureEvent.Reset();
            lastCaptureResult = null;
            reader.On_Captured += OnCaptured;

            int dpi = 500;
            try { dpi = reader.Capabilities.Resolutions[0]; } catch {}

            Constants.ResultCode rc = reader.CaptureAsync(Constants.Formats.Fid.ANSI, Constants.CaptureProcessing.DP_IMG_PROC_DEFAULT, dpi);
            if (rc != Constants.ResultCode.DP_SUCCESS)
            {
                Console.WriteLine("[capture] No se pudo iniciar captura: " + rc);
                reader.On_Captured -= OnCaptured;
                return null;
            }

            bool got = captureEvent.WaitOne(15000);
            if (!got) reader.CancelCapture();
            reader.On_Captured -= OnCaptured;

            if (!got || lastCaptureResult == null) { Console.WriteLine("[capture] Timeout — no se detecto dedo"); return null; }

            CaptureResult capture = lastCaptureResult;
            if (capture.ResultCode != Constants.ResultCode.DP_SUCCESS || capture.Data == null)
            {
                Console.WriteLine("[capture] Fallo: " + capture.ResultCode);
                return null;
            }

            DataResult<Fmd> fmdResult = FeatureExtraction.CreateFmdFromFid(capture.Data, Constants.Formats.Fmd.ANSI);
            if (fmdResult == null || fmdResult.ResultCode != Constants.ResultCode.DP_SUCCESS)
            {
                Console.WriteLine("[capture] FMD fallo: " + (fmdResult != null ? fmdResult.ResultCode.ToString() : "null"));
                return null;
            }
            Console.WriteLine("[capture] FMD OK — quality: " + capture.Quality);
            return fmdResult.Data;
        }
        catch (Exception e)
        {
            Console.WriteLine("[capture] Error: " + e.Message);
            try { reader.CancelCapture(); } catch {}
            return null;
        }
    }

    // ── Local persistence ───────────────────────────────────────────────────

    static void LoadTemplates()
    {
        if (!Directory.Exists(templatesDir)) { Directory.CreateDirectory(templatesDir); return; }
        int loaded = 0;
        foreach (string file in Directory.GetFiles(templatesDir, "*.b64"))
        {
            try
            {
                string sid = Path.GetFileNameWithoutExtension(file);
                byte[] data = Convert.FromBase64String(File.ReadAllText(file, Encoding.ASCII));
                DataResult<Fmd> result = Importer.ImportFmd(data, Constants.Formats.Fmd.ANSI, Constants.Formats.Fmd.ANSI);
                if (result != null && result.Data != null && result.Data.Bytes != null)
                {
                    lock (templatesLock) { templates[sid] = result.Data; }
                    loaded++;
                    Console.WriteLine("[load] " + sid);
                }
            }
            catch (Exception e) { Console.WriteLine("[load] Error en " + Path.GetFileName(file) + ": " + e.Message); }
        }
        Console.WriteLine("Templates locales cargados: " + loaded);
    }

    static void SaveTemplate(string staffId, Fmd fmd)
    {
        try
        {
            if (!Directory.Exists(templatesDir)) Directory.CreateDirectory(templatesDir);
            File.WriteAllText(Path.Combine(templatesDir, staffId + ".b64"), Convert.ToBase64String(fmd.Bytes), Encoding.ASCII);
            Console.WriteLine("[save] " + staffId);
        }
        catch (Exception e) { Console.WriteLine("[save] Error: " + e.Message); }
    }

    // ── Sync de templates vía el SERVIDOR (service_role del lado servidor) ────
    // La caja NO tiene el service_role (= llave maestra de TODOS los clientes). Manda el
    // secreto ACOTADO fingerprintSyncSecret al endpoint /api/pos/fingerprint, que hace la
    // escritura con service_role allá. Tabla: pos_fingerprint_templates. Multi-terminal:
    // enrola en la caja A → disponible en B tras el próximo arranque (SyncFromSupabase).
    // Si no hay syncSecret configurado, el servicio opera SOLO local (no sincroniza).

    static string SyncEndpoint() { return apiBaseUrl + "/api/pos/fingerprint"; }

    static WebClient CreateSyncClient()
    {
        var wc = new WebClient();
        wc.Encoding = Encoding.UTF8;
        wc.Headers.Add("x-fp-secret", syncSecret);
        wc.Headers.Add("Content-Type", "application/json");
        return wc;
    }

    static void SyncFromSupabase()
    {
        if (string.IsNullOrEmpty(syncSecret)) return;
        try
        {
            string url = SyncEndpoint() + "?client_id=" + Uri.EscapeDataString(clientId);
            WebClient wc = CreateSyncClient();
            string response = wc.DownloadString(url);

            // Respuesta: {"templates":[{"id":"...","template":"..."}, ...]}
            var idRe  = new Regex("\"id\"\\s*:\\s*\"([^\"]+)\"");
            var tplRe = new Regex("\"template\"\\s*:\\s*\"([^\"]+)\"");
            var ids   = idRe.Matches(response);
            var tpls  = tplRe.Matches(response);

            if (ids.Count != tpls.Count)
            {
                Console.WriteLine("[sync] Respuesta inesperada (ids=" + ids.Count + " templates=" + tpls.Count + ")");
                return;
            }

            int added = 0;
            for (int i = 0; i < ids.Count; i++)
            {
                string sid = ids[i].Groups[1].Value;
                string b64 = tpls[i].Groups[1].Value;
                bool have; lock (templatesLock) { have = templates.ContainsKey(sid); }
                if (have || string.IsNullOrEmpty(b64)) continue;
                try
                {
                    byte[] data = Convert.FromBase64String(b64);
                    DataResult<Fmd> r = Importer.ImportFmd(data, Constants.Formats.Fmd.ANSI, Constants.Formats.Fmd.ANSI);
                    if (r != null && r.Data != null)
                    {
                        lock (templatesLock) { templates[sid] = r.Data; }
                        SaveTemplate(sid, r.Data);
                        added++;
                    }
                }
                catch (Exception e) { Console.WriteLine("[sync] Error importando template " + sid + ": " + e.Message); }
            }
            if (added > 0) Console.WriteLine("[sync] " + added + " template(s) descargado(s) del servidor");
        }
        catch (Exception e) { Console.WriteLine("[sync] Error bajando templates: " + e.Message); }
    }

    static void SyncToSupabase(string staffId, Fmd fmd)
    {
        if (string.IsNullOrEmpty(syncSecret)) return;
        try
        {
            string b64  = Convert.ToBase64String(fmd.Bytes);
            string json = "{\"client_id\":\"" + EscapeJson(clientId) + "\",\"staff_id\":\"" + EscapeJson(staffId) + "\",\"template\":\"" + b64 + "\"}";
            WebClient wc = CreateSyncClient();
            wc.UploadString(SyncEndpoint(), "POST", json);
            Console.WriteLine("[sync] " + staffId + " → servidor OK");
        }
        catch (Exception e) { Console.WriteLine("[sync] Error enviando " + staffId + ": " + e.Message); }
    }

    static void SyncDeleteFromSupabase(string staffId)
    {
        if (string.IsNullOrEmpty(syncSecret)) return;
        try
        {
            string url = SyncEndpoint() + "?client_id=" + Uri.EscapeDataString(clientId)
                       + "&staff_id=" + Uri.EscapeDataString(staffId);
            WebClient wc = CreateSyncClient();
            wc.UploadString(url, "DELETE", "");
            Console.WriteLine("[sync] " + staffId + " eliminado del servidor");
        }
        catch (Exception e) { Console.WriteLine("[sync] Error eliminando " + staffId + ": " + e.Message); }
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    static string EscapeJson(string s)
    {
        if (s == null) return "";
        return s.Replace("\\", "\\\\").Replace("\"", "\\\"")
                .Replace("\n", "\\n").Replace("\r", "\\r").Replace("\t", "\\t");
    }
}
