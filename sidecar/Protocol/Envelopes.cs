using System.Text.Json;
using System.Text.Json.Serialization;

namespace JevSidecar.Protocol;

/// <summary>
/// The wire format. Mirrors src/adapters/windows/protocol.ts exactly; the two
/// must change together.
/// </summary>
internal static class Wire
{
    public const int ProtocolVersion = 1;

    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        // Protocol lines must be exactly one line each.
        WriteIndented = false,
    };
}

internal sealed record RequestEnvelope(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("command")] string Command,
    [property: JsonPropertyName("params")] JsonElement Params);

internal sealed record ErrorBody(
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("message")] string Message);

/// <summary>A response is written as either a success or a failure, never both.</summary>
internal sealed record ResponseEnvelope
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("ok")]
    public required bool Ok { get; init; }

    [JsonPropertyName("result")]
    public object? Result { get; init; }

    [JsonPropertyName("error")]
    public ErrorBody? Error { get; init; }

    public static ResponseEnvelope Success(string id, object result) =>
        new() { Id = id, Ok = true, Result = result };

    public static ResponseEnvelope Failure(string id, string code, string message) =>
        new() { Id = id, Ok = false, Error = new ErrorBody(code, message) };
}

internal sealed record RectDto(double X, double Y, double Width, double Height);

internal sealed record ForegroundWindowDto(
    int ProcessId,
    string ProcessName,
    string Title,
    RectDto Bounds);

internal sealed record CaptureDto(
    string ImageBase64,
    int Width,
    int Height,
    double DisplayScale,
    ForegroundWindowDto Foreground);

internal sealed record PingDto(int ProtocolVersion, string SidecarVersion, int ProcessId);

/// <summary>One recognised line, in full-image pixels.</summary>
internal sealed record OcrLineDto(string Text, double Confidence, RectDto Bounds);

internal sealed record OcrResultDto(IReadOnlyList<OcrLineDto> Lines, string Language);
