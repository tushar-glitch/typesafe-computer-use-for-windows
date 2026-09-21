using System.IO;
using System.Text;
using System.Text.Json;
using JevSidecar.Commands;
using JevSidecar.Native;
using JevSidecar.Protocol;

namespace JevSidecar;

/// <summary>
/// The host loop: read a request line, dispatch it, write exactly one response line.
///
/// stdout carries protocol traffic and nothing else — a stray Console.WriteLine
/// would desynchronise the client — so all diagnostics go to stderr.
/// </summary>
internal static class Program
{
    private static int Main()
    {
        // Must run before any window or screen query, or every rectangle comes
        // back in virtualised coordinates on a scaled display.
        _ = NativeMethods.SetProcessDpiAwarenessContext(NativeMethods.DpiAwarenessContextPerMonitorAwareV2);

        Console.OutputEncoding = Encoding.UTF8;
        Console.InputEncoding = Encoding.UTF8;

        using StreamWriter stdout = new(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };

        Dictionary<string, ICommandHandler> handlers = BuildHandlers();
        // Off the hot path: the OCR engine builds while the client is still
        // connecting, so the first capture does not pay for it.
        _ = Task.Run(static () =>
        {
            try
            {
                TextRecognizer.Warmup();
            }
            catch (Exception error)
            {
                Console.Error.WriteLine($"OCR warmup failed, first request will pay for it: {error.Message}");
            }
        });

        Console.Error.WriteLine($"jev-sidecar ready; commands: {string.Join(", ", handlers.Keys.Order())}");

        string? line;
        while ((line = Console.ReadLine()) is not null)
        {
            if (line.Length == 0)
            {
                continue;
            }

            ResponseEnvelope response = Handle(line, handlers);
            stdout.WriteLine(JsonSerializer.Serialize(response, Wire.Options));
        }

        return 0;
    }

    private static Dictionary<string, ICommandHandler> BuildHandlers()
    {
        // Shared across commands so a handle from uia_tree still resolves when
        // a later command acts on it.
        ElementRegistry registry = new();

        ICommandHandler[] handlers =
        [
            new PingCommand(),
            new ForegroundCommand(),
            new CaptureCommand(),
            new OcrCommand(),
            new UiaTreeCommand(registry),
        ];
        return handlers.ToDictionary(handler => handler.Name, StringComparer.Ordinal);
    }

    private static ResponseEnvelope Handle(string line, IReadOnlyDictionary<string, ICommandHandler> handlers)
    {
        RequestEnvelope? request;
        try
        {
            request = JsonSerializer.Deserialize<RequestEnvelope>(line, Wire.Options);
        }
        catch (JsonException error)
        {
            // No id to correlate with, so the client will time this out. Say why on stderr.
            Console.Error.WriteLine($"unparseable request: {error.Message}");
            return ResponseEnvelope.Failure("unknown", "malformed-request", error.Message);
        }

        if (request is null || string.IsNullOrEmpty(request.Id))
        {
            return ResponseEnvelope.Failure("unknown", "malformed-request", "request had no id");
        }

        if (!handlers.TryGetValue(request.Command, out ICommandHandler? handler))
        {
            return ResponseEnvelope.Failure(request.Id, "unknown-command", $"no handler for '{request.Command}'");
        }

        try
        {
            return ResponseEnvelope.Success(request.Id, handler.Execute(request.Params));
        }
        catch (SidecarCommandException expected)
        {
            return ResponseEnvelope.Failure(request.Id, expected.Code, expected.Message);
        }
        catch (Exception unexpected)
        {
            Console.Error.WriteLine($"{request.Command} threw: {unexpected}");
            return ResponseEnvelope.Failure(request.Id, "internal", unexpected.Message);
        }
    }
}
