using System.Text.Json;
using JevSidecar.Native;
using JevSidecar.Protocol;

namespace JevSidecar.Commands;

/// <summary>The foreground window's controls, plus whatever holds keyboard focus.</summary>
internal sealed class UiaTreeCommand : ICommandHandler
{
    private readonly ElementRegistry _registry;

    public UiaTreeCommand(ElementRegistry registry) => _registry = registry;

    public string Name => "uia_tree";

    public object Execute(JsonElement parameters)
    {
        // Every monitor, not just the primary one: a window on a secondary
        // display sits at coordinates outside the primary rectangle.
        return UiaWalker.Walk(_registry, WindowProbe.ToDto(NativeMethods.VirtualScreen()));
    }
}
