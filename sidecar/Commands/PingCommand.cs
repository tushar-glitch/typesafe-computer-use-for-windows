using System.Diagnostics;
using System.Text.Json;
using JevSidecar.Protocol;

namespace JevSidecar.Commands;

/// <summary>Liveness and version handshake. Does not touch the screen.</summary>
internal sealed class PingCommand : ICommandHandler
{
    public string Name => "ping";

    public object Execute(JsonElement parameters) =>
        new PingDto(
            ProtocolVersion: Wire.ProtocolVersion,
            SidecarVersion: typeof(PingCommand).Assembly.GetName().Version?.ToString() ?? "0.0.0",
            ProcessId: Environment.ProcessId);
}
