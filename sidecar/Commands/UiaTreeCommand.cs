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
        RectDto display = WindowProbe.ToDto(NativeMethods.VirtualScreen());

        return Budget(parameters) is int budgetMs
            ? UiaWalker.Walk(_registry, display, budgetMs)
            : UiaWalker.Walk(_registry, display);
    }

    /// <summary>Caller-supplied wall-clock ceiling, clamped to something sane.</summary>
    private static int? Budget(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object
            || !parameters.TryGetProperty("budgetMs", out JsonElement value)
            || value.ValueKind != JsonValueKind.Number)
        {
            return null;
        }

        return Math.Clamp(value.GetInt32(), 50, 5000);
    }
}
