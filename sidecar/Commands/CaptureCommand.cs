using System.Text.Json;
using JevSidecar.Native;
using JevSidecar.Protocol;

namespace JevSidecar.Commands;

/// <summary>A PNG of the display or of the foreground window.</summary>
internal sealed class CaptureCommand : ICommandHandler
{
    private const string DefaultTarget = "primary-display";

    public string Name => "capture";

    public object Execute(JsonElement parameters)
    {
        string target = DefaultTarget;
        if (parameters.ValueKind == JsonValueKind.Object
            && parameters.TryGetProperty("target", out JsonElement value)
            && value.ValueKind == JsonValueKind.String)
        {
            target = value.GetString() ?? DefaultTarget;
        }

        return ScreenGrabber.Capture(target);
    }
}
