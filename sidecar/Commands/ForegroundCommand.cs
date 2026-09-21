using System.Text.Json;
using JevSidecar.Native;

namespace JevSidecar.Commands;

/// <summary>Which window the user is looking at.</summary>
internal sealed class ForegroundCommand : ICommandHandler
{
    public string Name => "foreground";

    public object Execute(JsonElement parameters) => WindowProbe.Foreground();
}
