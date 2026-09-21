using System.Text.Json;
using JevSidecar.Native;
using JevSidecar.Protocol;

namespace JevSidecar.Commands;

/// <summary>The foreground window's controls, plus whatever holds keyboard focus.</summary>
internal sealed class UiaTreeCommand : ICommandHandler
{
    private const int SmCxScreen = 0;
    private const int SmCyScreen = 1;

    private readonly ElementRegistry _registry;

    public UiaTreeCommand(ElementRegistry registry) => _registry = registry;

    public string Name => "uia_tree";

    public object Execute(JsonElement parameters)
    {
        RectDto display = new(
            0,
            0,
            NativeMethods.GetSystemMetrics(SmCxScreen),
            NativeMethods.GetSystemMetrics(SmCyScreen));

        return UiaWalker.Walk(_registry, display);
    }
}
