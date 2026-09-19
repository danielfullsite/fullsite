// Fullsite Fingerprint Service
// Compile: C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /r:DPUruNet.dll /out:fingerprint-service.exe fingerprint-service.cs
// Run: fingerprint-service.exe
// Endpoints:
//   GET  /health    → reader status
//   GET  /capture   → capture fingerprint, return "place finger" then wait
//   GET  /enroll?id=STAFF_ID  → capture 4x, create template, save
//   GET  /identify  → capture 1x, match against all templates, return staff_id
//   GET  /list      → list enrolled staff IDs
//   GET  /delete?id=STAFF_ID  → delete template

using System;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Collections.Generic;
using DPUruNet;

// Supabase sync config — templates sync across all terminals
// Uses pos_fingerprint_templates table: id (text PK), client_id (text), xml (text), updated_at (timestamptz)

class FingerprintService
{
    static Reader reader;
    static Dictionary<string, Fmd> templates = new Dictionary<string, Fmd>();
    static string templatesDir = @"C:\fullsite\fingerprints";
    const int DPFJ_PROBABILITY_ONE = 0x7FFFFFFF;
    const int FALSE_POSITIVE_RATE = DPFJ_PROBABILITY_ONE / 100000;

    static void Main(string[] args)
    {
        // Enable TLS 1.2 (required for Supabase HTTPS on Windows 10 LTSC)
        System.Net.ServicePointManager.SecurityProtocol = System.Net.SecurityProtocolType.Tls12;

        Console.WriteLine("Fullsite Fingerprint Service");
        Console.WriteLine("============================");

        // Create templates directory
        if (!Directory.Exists(templatesDir))
            Directory.CreateDirectory(templatesDir);

        // Load saved templates from local files, sync to/from Supabase
        LoadTemplates();
        ThreadPool.QueueUserWorkItem(_ => {
            // First upload any local templates to Supabase
            foreach (var entry in templates)
            {
                SyncToSupabase(entry.Key, entry.Value);
            }
            // Then download any templates from other terminals
            SyncFromSupabase();
        });

        // Open fingerprint reader
        if (!OpenReader())
        {
            Console.WriteLine("ERROR: No se encontro lector de huella");
            Console.WriteLine("Presiona Enter para salir...");
            Console.ReadLine();
            return;
        }

        Console.WriteLine("Lector: " + reader.Description.Name);
        Console.WriteLine("Serial: " + reader.Description.SerialNumber);

        // Start HTTP server on port 7718
        HttpListener listener = new HttpListener();
        listener.Prefixes.Add("http://127.0.0.1:7718/");
        try
        {
            listener.Start();
        }
        catch (Exception e)
        {
            Console.WriteLine("ERROR al iniciar servidor: " + e.Message);
            Console.WriteLine("Ejecuta como administrador o verifica que el puerto 7718 este libre");
            Console.ReadLine();
            return;
        }

        Console.WriteLine("Servicio en http://127.0.0.1:7718");
        Console.WriteLine("Templates guardados: " + templates.Count);
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
                Console.WriteLine("Error: " + e.Message);
            }
        }
    }

    static bool OpenReader()
    {
        try
        {
            ReaderCollection readers = ReaderCollection.GetReaders();
            if (readers == null || readers.Count == 0) return false;

            reader = readers[0];
            Constants.ResultCode rc = reader.Open(Constants.CapturePriority.DP_PRIORITY_EXCLUSIVE);
            if (rc != Constants.ResultCode.DP_SUCCESS)
            {
                Console.WriteLine("Error abriendo lector: " + rc);
                return false;
            }
            return true;
        }
        catch (Exception e)
        {
            Console.WriteLine("Error: " + e.Message);
            return false;
        }
    }

    static void HandleRequest(HttpListenerContext ctx)
    {
        HttpListenerRequest req = ctx.Request;
        HttpListenerResponse res = ctx.Response;

        // CORS
        res.Headers.Add("Access-Control-Allow-Origin", "*");
        res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.Headers.Add("Access-Control-Allow-Headers", "Content-Type");

        if (req.HttpMethod == "OPTIONS")
        {
            res.StatusCode = 204;
            res.Close();
            return;
        }

        string path = req.Url.AbsolutePath;
        string query = req.Url.Query;
        string staffId = req.QueryString["id"] ?? "";
        string json = "";

        try
        {
            switch (path)
            {
                case "/health":
                    json = "{\"ok\":true,\"reader\":\"" + Escape(reader.Description.Name) + "\",\"enrolled\":" + templates.Count + "}";
                    break;

                case "/enroll":
                    if (string.IsNullOrEmpty(staffId))
                    {
                        json = "{\"error\":\"Falta parametro id\"}";
                        res.StatusCode = 400;
                    }
                    else
                    {
                        json = DoEnroll(staffId);
                    }
                    break;

                case "/identify":
                    json = DoIdentify();
                    break;

                case "/list":
                    json = DoList();
                    break;

                case "/delete":
                    if (string.IsNullOrEmpty(staffId))
                    {
                        json = "{\"error\":\"Falta parametro id\"}";
                        res.StatusCode = 400;
                    }
                    else
                    {
                        json = DoDelete(staffId);
                    }
                    break;

                default:
                    json = "{\"error\":\"Ruta no encontrada\"}";
                    res.StatusCode = 404;
                    break;
            }
        }
        catch (Exception e)
        {
            json = "{\"error\":\"" + Escape(e.Message) + "\"}";
            res.StatusCode = 500;
            Console.WriteLine("[ERROR] " + path + ": " + e.Message);
        }

        byte[] buf = Encoding.UTF8.GetBytes(json);
        res.ContentType = "application/json; charset=utf-8";
        res.ContentLength64 = buf.Length;
        res.OutputStream.Write(buf, 0, buf.Length);
        res.Close();
    }

    static string DoEnroll(string staffId)
    {
        Console.WriteLine("[enroll] " + staffId + " — coloca el dedo 4 veces");

        List<Fmd> fmds = new List<Fmd>();

        for (int i = 0; i < 4; i++)
        {
            Console.WriteLine("[enroll] Captura " + (i + 1) + "/4...");
            Fmd fmd = CaptureFmd();
            if (fmd == null)
                return "{\"error\":\"Captura fallida en intento " + (i + 1) + ". Vuelve a intentar.\"}";
            fmds.Add(fmd);
            Console.WriteLine("[enroll] Captura " + (i + 1) + " OK");
            if (i < 3) {
                Console.WriteLine("[enroll] Quita el dedo...");
                Thread.Sleep(2000); // Wait for finger to be removed
            }
        }

        // Create enrollment FMD from 4 samples
        DataResult<Fmd> enrollResult = DPUruNet.Enrollment.CreateEnrollmentFmd(
            Constants.Formats.Fmd.ANSI, fmds);

        if (enrollResult == null || enrollResult.ResultCode != Constants.ResultCode.DP_SUCCESS)
        {
            return "{\"error\":\"Error creando template: " + (enrollResult != null ? enrollResult.ResultCode.ToString() : "null") + "\"}";
        }

        // Save template locally and sync to cloud
        templates[staffId] = enrollResult.Data;
        SaveTemplate(staffId, enrollResult.Data);
        ThreadPool.QueueUserWorkItem(_ => SyncToSupabase(staffId, enrollResult.Data));

        Console.WriteLine("[enroll] " + staffId + " registrado OK");
        return "{\"ok\":true,\"staffId\":\"" + Escape(staffId) + "\"}";
    }

    static string DoIdentify()
    {
        if (templates.Count == 0)
            return "{\"error\":\"No hay huellas registradas\"}";

        Console.WriteLine("[identify] Esperando huella...");
        Fmd fmd = CaptureFmd();
        if (fmd == null)
            return "{\"error\":\"No se pudo capturar la huella\"}";

        // Compare against all enrolled templates
        string bestMatch = null;
        int bestScore = int.MaxValue;

        foreach (KeyValuePair<string, Fmd> entry in templates)
        {
            try
            {
                CompareResult result = Comparison.Compare(entry.Value, 0, fmd, 0);
                if (result.Score < FALSE_POSITIVE_RATE && result.Score < bestScore)
                {
                    bestScore = result.Score;
                    bestMatch = entry.Key;
                }
            }
            catch (Exception e)
            {
                Console.WriteLine("[identify] Error comparando " + entry.Key + ": " + e.Message);
            }
        }

        if (bestMatch != null)
        {
            Console.WriteLine("[identify] Match: " + bestMatch + " (score: " + bestScore + ")");
            return "{\"ok\":true,\"staffId\":\"" + Escape(bestMatch) + "\",\"score\":" + bestScore + "}";
        }

        Console.WriteLine("[identify] Sin coincidencia");
        return "{\"ok\":false,\"error\":\"Huella no reconocida\"}";
    }

    static string DoList()
    {
        StringBuilder sb = new StringBuilder();
        sb.Append("{\"enrolled\":[");
        int i = 0;
        foreach (string key in templates.Keys)
        {
            if (i > 0) sb.Append(",");
            sb.Append("\"" + Escape(key) + "\"");
            i++;
        }
        sb.Append("],\"count\":" + templates.Count + "}");
        return sb.ToString();
    }

    static string DoDelete(string staffId)
    {
        if (templates.ContainsKey(staffId))
        {
            templates.Remove(staffId);
            string path = Path.Combine(templatesDir, staffId + ".fmd");
            if (File.Exists(path)) File.Delete(path);
            Console.WriteLine("[delete] " + staffId + " eliminado");
            return "{\"ok\":true}";
        }
        return "{\"error\":\"No encontrado\"}";
    }

    // Event-based capture (streaming mode)
    static ManualResetEvent captureEvent = new ManualResetEvent(false);
    static CaptureResult lastCaptureResult;

    static void OnCaptured(CaptureResult result)
    {
        lastCaptureResult = result;
        captureEvent.Set();
    }

    static Fmd CaptureFmd()
    {
        try
        {
            Console.WriteLine("[capture] Pon tu dedo en el lector (luz azul)...");

            // Cancel any pending capture first
            try { reader.CancelCapture(); } catch {}
            Thread.Sleep(200);

            // Use async capture
            captureEvent.Reset();
            lastCaptureResult = null;

            reader.On_Captured += OnCaptured;

            int dpi = 500;
            try { dpi = reader.Capabilities.Resolutions[0]; } catch {}

            Constants.ResultCode startResult = reader.CaptureAsync(
                Constants.Formats.Fid.ANSI,
                Constants.CaptureProcessing.DP_IMG_PROC_DEFAULT,
                dpi);
            Console.WriteLine("[capture] CaptureAsync: " + startResult);

            if (startResult != Constants.ResultCode.DP_SUCCESS)
            {
                Console.WriteLine("[capture] No se pudo iniciar captura asincrona");
                reader.On_Captured -= OnCaptured;
                return null;
            }

            // Wait up to 15 seconds for finger
            bool gotCapture = captureEvent.WaitOne(15000);

            if (!gotCapture) reader.CancelCapture();
            reader.On_Captured -= OnCaptured;

            if (!gotCapture || lastCaptureResult == null)
            {
                Console.WriteLine("[capture] Timeout - no se detecto dedo");
                return null;
            }

            CaptureResult capture = lastCaptureResult;
            Console.WriteLine("[capture] ResultCode: " + capture.ResultCode);
            Console.WriteLine("[capture] Quality: " + capture.Quality);

            if (capture.ResultCode != Constants.ResultCode.DP_SUCCESS || capture.Data == null)
            {
                Console.WriteLine("[capture] Fallo: " + capture.ResultCode);
                return null;
            }

            Console.WriteLine("[capture] Imagen capturada: " + capture.Data.Bytes.Length + " bytes");

            DataResult<Fmd> fmdResult = FeatureExtraction.CreateFmdFromFid(
                capture.Data, Constants.Formats.Fmd.ANSI);

            if (fmdResult == null || fmdResult.ResultCode != Constants.ResultCode.DP_SUCCESS)
            {
                Console.WriteLine("[capture] FMD fallo: " + (fmdResult != null ? fmdResult.ResultCode.ToString() : "null"));
                return null;
            }

            Console.WriteLine("[capture] FMD creado OK");
            return fmdResult.Data;
        }
        catch (Exception e)
        {
            Console.WriteLine("[capture] Error: " + e.Message);
            try { reader.CancelCapture(); } catch {}
            return null;
        }
    }

    static void LoadTemplates()
    {
        if (!Directory.Exists(templatesDir)) Directory.CreateDirectory(templatesDir);
        foreach (string file in Directory.GetFiles(templatesDir, "*.b64"))
        {
            try
            {
                string staffId = Path.GetFileNameWithoutExtension(file);
                byte[] data = Convert.FromBase64String(File.ReadAllText(file));
                Fmd fmd = Importer.ImportFmd(data, Constants.Formats.Fmd.ANSI, Constants.Formats.Fmd.ANSI).Data;
                if (fmd != null && fmd.Bytes != null)
                {
                    templates[staffId] = fmd;
                    Console.WriteLine("[load] " + staffId + " cargado");
                }
            }
            catch (Exception e)
            {
                Console.WriteLine("[load] Error: " + file + ": " + e.Message);
            }
        }
        Console.WriteLine("Templates cargados: " + templates.Count);
    }

    static void SaveTemplate(string staffId, Fmd fmd)
    {
        try
        {
            if (!Directory.Exists(templatesDir)) Directory.CreateDirectory(templatesDir);
            string b64 = Convert.ToBase64String(fmd.Bytes);
            File.WriteAllText(Path.Combine(templatesDir, staffId + ".b64"), b64);
            Console.WriteLine("[save] " + staffId + " guardado");
        }
        catch (Exception e)
        {
            Console.WriteLine("[save] Error: " + e.Message);
        }
    }

    // ── Supabase sync ──────────────────────────────────────────────────────
    static string SUPABASE_URL = "https://qjiomlvudfmzuvqvhwpk.supabase.co";
    static string SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqaW9tbHZ1ZGZtenV2cXZod3BrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3ODQ5MTUsImV4cCI6MjA5MTM2MDkxNX0.nv1ctxRJbc8kzD5gPypoxZ4uLtxOX61Me2ype5GBXyU";
    static string CLIENT_ID = "amalay";

    static void SyncFromSupabase()
    {
        try
        {
            string url = SUPABASE_URL + "/rest/v1/pos_fingerprint_templates?client_id=eq." + CLIENT_ID + "&select=id,template";
            WebClient wc = new WebClient();
            wc.Headers.Add("apikey", SUPABASE_KEY);
            wc.Headers.Add("Authorization", "Bearer " + SUPABASE_KEY);
            string response = wc.DownloadString(url);

            int loaded = 0;
            int idx = 0;
            while ((idx = response.IndexOf("\"id\":", idx)) >= 0)
            {
                try
                {
                    int idStart = response.IndexOf("\"", idx + 5) + 1;
                    int idEnd = response.IndexOf("\"", idStart);
                    string staffId = response.Substring(idStart, idEnd - idStart);

                    int tplStart = response.IndexOf("\"template\":\"", idEnd) + 12;
                    int tplEnd = response.IndexOf("\"", tplStart);
                    string b64 = response.Substring(tplStart, tplEnd - tplStart);

                    if (!templates.ContainsKey(staffId) && b64.Length > 10)
                    {
                        byte[] data = Convert.FromBase64String(b64);
                        Fmd fmd = Importer.ImportFmd(data, Constants.Formats.Fmd.ANSI, Constants.Formats.Fmd.ANSI).Data;
                        if (fmd != null)
                        {
                            templates[staffId] = fmd;
                            SaveTemplate(staffId, fmd);
                            loaded++;
                        }
                    }
                    idx = tplEnd + 1;
                }
                catch { idx++; }
            }
            if (loaded > 0) Console.WriteLine("[sync] " + loaded + " templates de Supabase");
        }
        catch (Exception e)
        {
            Console.WriteLine("[sync] Error Supabase: " + e.Message);
        }
    }

    static void SyncToSupabase(string staffId, Fmd fmd)
    {
        try
        {
            string b64 = Convert.ToBase64String(fmd.Bytes);
            string json = "{\"id\":\"" + staffId + "\",\"client_id\":\"" + CLIENT_ID + "\",\"template\":\"" + b64 + "\"}";

            WebClient wc = new WebClient();
            wc.Headers.Add("apikey", SUPABASE_KEY);
            wc.Headers.Add("Authorization", "Bearer " + SUPABASE_KEY);
            wc.Headers.Add("Content-Type", "application/json");
            wc.Headers.Add("Prefer", "resolution=merge-duplicates");
            wc.UploadString(SUPABASE_URL + "/rest/v1/pos_fingerprint_templates", "POST", json);
            Console.WriteLine("[sync] " + staffId + " → Supabase OK");
        }
        catch (Exception e)
        {
            Console.WriteLine("[sync] Error: " + e.Message);
        }
    }

    static string Escape(string s)
    {
        if (s == null) return "";
        return s.Replace("\\", "\\\\").Replace("\"", "'").Replace("\n", " ").Replace("\r", "");
    }
}
