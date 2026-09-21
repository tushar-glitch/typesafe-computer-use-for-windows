using System.Text.Json;

namespace JevSidecar.Commands;

/// <summary>
/// One protocol command.
///
/// Handlers are registered by name and know nothing about framing, ids or
/// error envelopes; the host loop owns all of that.
/// </summary>
internal interface ICommandHandler
{
    string Name { get; }

    /// <summary>The result object, serialised by the host as the response payload.</summary>
    object Execute(JsonElement parameters);
}
