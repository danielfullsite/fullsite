// Fullsite Fingerprint Service — multi-tenant
// Compile: C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /r:DPUruNet.dll /out:fingerprint-service.exe fingerprint-service.cs
// Prerequisites: DPUruNet.dll in the same directory as the exe.
// Config: reads C:\fullsite\config.json for restaurant_id, supabaseUrl, supabaseAnonKey.
//
// Endpoints:
//   GET  /health                → reader status + enrolled count
//   GET  /enroll?id=STAFF_ID   → 4-sample enrollment, saves template locally + Supabase
//   GET  /identify              → 1-sample 1:N match, returns staffId
//   GET  /list                  → enrolled staff IDs
//   GET  /delete?id=STAFF_ID   → delete locally + from Supabase

using System;
using System.IO;
using System.Net;
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

    // Loaded from C:\fullsite\config.json — never hardcoded
    static string supabaseUrl = "";
    static string supabaseKey = "";
    static string clientId    = "";

    static void Main(string[] args)
    {
        System.Net.ServicePointManager.SecurityProtocol = System.Net.SecurityProtocolType.Tls12;

        Console.WriteLine("Fullsite Fingerprint Service");
        Console.WriteLine("============================");

        if (!LoadConfig())
        {
            Console.WriteLine("FATAL: No se pudo leer C:\\fullsite\\config.json");
            Console.WriteLine("Asegurate de que el archivo exista y contenga: restaurant_id, supabaseUrl, supabaseAnonKey");
            Console.ReadLine();
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

    static bool LoadConfig()
    {
        string configPath = @"C:\fullsite\config.json";
        try
        {
            if (!File.Exists(configPath))
            {
                Console.WriteLine("config.json no encontrado en " + configPath);
                return false;
            }
            string json = File.ReadAllText(configPath, Encoding.UTF8);

            string rid = ExtractJsonString(json, "restaurant_id") ?? ExtractJsonString(json, "restaurantId");
            string url = ExtractJsonString(json, "supabaseUrl");
            string key = ExtractJsonString(json, "supabaseAnonKey");

            if (string.IsNullOrEmpty(rid)) { Console.WriteLine("config.json: falta 'restaurant_id'"); return false; }
            if (string.IsNullOrEmpty(url)) { Console.WriteLine("config.json: falta 'supabaseUrl'");   return false; }
            if (string.IsNullOrEmpty(key)) { Console.WriteLine("config.json: falta 'supabaseAnonKey'"); return false; }

            clientId    = rid.ToLowerInvariant().Trim();
            supabaseUrl = url.TrimEnd('/');
            supabaseKey = key;
            return true;
        }
        catch (Exception e)
        {
            Console.WriteLine("Error leyendo config.json: " + e.Message);
            return false;
        }
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
        res.Headers.Add("Access-Control-Allow-Origin", "*");
        res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.Headers.Add("Access-Control-Allow-Headers", "Content-Type");

        if (req.HttpMethod == "OPTIONS") { res.StatusCode = 204; res.Close(); return; }

        string path    = req.Url.AbsolutePath;
        string staffId = req.QueryString["id"] ?? "";
        string json    = "";

        try
        {
            switch (path)
            {
                case "/health":
                    int cnt; lock (templatesLock) { cnt = templates.Count; }
                    json = "{\"ok\":true,\"reader\":\"" + EscapeJson(reader.Description.Name) + "\",\"enrolled\":" + cnt + ",\"client_id\":\"" + EscapeJson(clientId) + "\"}";
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
        catch (Exception e)
        {
            json = "{\"error\":\"" + EscapeJson(e.Message) + "\"}";
            res.StatusCode = 500;
            Console.WriteLine("[ERROR] " + path + ": " + e.Message);
        }

        byte[] buf = Encoding.UTF8.GetBytes(json);
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

    // ── Supabase sync ───────────────────────────────────────────────────────
    // Table: pos_fingerprint_templates (id TEXT PK, client_id TEXT, template TEXT, updated_at TIMESTAMPTZ)
    // Templates are synced per client_id so multi-terminal enrollment works:
    // enroll on terminal A → available on terminal B after next startup sync.

    static void SyncFromSupabase()
    {
        if (string.IsNullOrEmpty(supabaseUrl) || string.IsNullOrEmpty(supabaseKey)) return;
        try
        {
            string url = supabaseUrl + "/rest/v1/pos_fingerprint_templates?client_id=eq."
                       + Uri.EscapeDataString(clientId) + "&select=id,template";
            WebClient wc = CreateWebClient();
            string response = wc.DownloadString(url);

            // Parse [{\"id\":\"...\",\"template\":\"...\"}, ...]
            // Both fields are plain base64/alphanumeric so capturing [^"]+ is safe.
            var idRe  = new Regex("\"id\"\\s*:\\s*\"([^\"]+)\"");
            var tplRe = new Regex("\"template\"\\s*:\\s*\"([^\"]+)\"");
            var ids   = idRe.Matches(response);
            var tpls  = tplRe.Matches(response);

            if (ids.Count != tpls.Count)
            {
                Console.WriteLine("[sync] Respuesta inesperada de Supabase (ids=" + ids.Count + " templates=" + tpls.Count + ")");
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
            if (added > 0) Console.WriteLine("[sync] " + added + " template(s) descargado(s) de Supabase");
        }
        catch (Exception e) { Console.WriteLine("[sync] Error Supabase: " + e.Message); }
    }

    static void SyncToSupabase(string staffId, Fmd fmd)
    {
        if (string.IsNullOrEmpty(supabaseUrl) || string.IsNullOrEmpty(supabaseKey)) return;
        try
        {
            string b64  = Convert.ToBase64String(fmd.Bytes);
            string json = "{\"id\":\"" + EscapeJson(staffId) + "\",\"client_id\":\"" + EscapeJson(clientId) + "\",\"template\":\"" + b64 + "\"}";
            WebClient wc = CreateWebClient();
            wc.Headers.Add("Content-Type", "application/json");
            wc.Headers.Add("Prefer", "resolution=merge-duplicates");
            wc.UploadString(supabaseUrl + "/rest/v1/pos_fingerprint_templates", "POST", json);
            Console.WriteLine("[sync] " + staffId + " → Supabase OK");
        }
        catch (Exception e) { Console.WriteLine("[sync] Error enviando " + staffId + ": " + e.Message); }
    }

    static void SyncDeleteFromSupabase(string staffId)
    {
        if (string.IsNullOrEmpty(supabaseUrl) || string.IsNullOrEmpty(supabaseKey)) return;
        try
        {
            string url = supabaseUrl + "/rest/v1/pos_fingerprint_templates?id=eq."
                       + Uri.EscapeDataString(staffId) + "&client_id=eq." + Uri.EscapeDataString(clientId);
            WebClient wc = CreateWebClient();
            wc.UploadString(url, "DELETE", "");
            Console.WriteLine("[sync] " + staffId + " eliminado de Supabase");
        }
        catch (Exception e) { Console.WriteLine("[sync] Error eliminando " + staffId + ": " + e.Message); }
    }

    static WebClient CreateWebClient()
    {
        var wc = new WebClient();
        wc.Encoding = Encoding.UTF8;
        wc.Headers.Add("apikey", supabaseKey);
        wc.Headers.Add("Authorization", "Bearer " + supabaseKey);
        return wc;
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    static string EscapeJson(string s)
    {
        if (s == null) return "";
        return s.Replace("\\", "\\\\").Replace("\"", "\\\"")
                .Replace("\n", "\\n").Replace("\r", "\\r").Replace("\t", "\\t");
    }
}
