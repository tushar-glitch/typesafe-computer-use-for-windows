using System.Text.Json;
using JevSidecar.Native;
using JevSidecar.Protocol;

namespace JevSidecar.Commands;

/// <summary>
/// Acting on controls through the accessibility tree, by handle.
///
/// Each takes a handle issued by a previous uia_tree walk, so these commands
/// share the registry that walk populated.
/// </summary>
internal static class ElementCommands
{
    public static IEnumerable<ICommandHandler> All(ElementRegistry registry) =>
    [
        new InvokeElementCommand(registry),
        new SetElementValueCommand(registry),
        new FocusElementCommand(registry),
        new ReadElementValueCommand(registry),
    ];
}

/// <summary>
/// Whether the control accepted the action.
///
/// False is an ordinary outcome, not an error: plenty of controls advertise a
/// pattern and then decline it. The caller falls back to a synthetic click.
/// </summary>
internal sealed record ElementActionDto(bool Accepted);

internal sealed record ElementValueDto(string? Value);

internal sealed class InvokeElementCommand(ElementRegistry registry) : ICommandHandler
{
    public string Name => "element_invoke";

    public object Execute(JsonElement parameters) =>
        new ElementActionDto(ElementActions.Invoke(registry, ParamReader.RequiredString(parameters, "handle")));
}

internal sealed class SetElementValueCommand(ElementRegistry registry) : ICommandHandler
{
    public string Name => "element_set_value";

    public object Execute(JsonElement parameters) =>
        new ElementActionDto(
            ElementActions.SetValue(
                registry,
                ParamReader.RequiredString(parameters, "handle"),
                ParamReader.RequiredString(parameters, "text")));
}

internal sealed class FocusElementCommand(ElementRegistry registry) : ICommandHandler
{
    public string Name => "element_focus";

    public object Execute(JsonElement parameters) =>
        new ElementActionDto(ElementActions.Focus(registry, ParamReader.RequiredString(parameters, "handle")));
}

internal sealed class ReadElementValueCommand(ElementRegistry registry) : ICommandHandler
{
    public string Name => "element_read_value";

    public object Execute(JsonElement parameters) =>
        new ElementValueDto(ElementActions.ReadValue(registry, ParamReader.RequiredString(parameters, "handle")));
}
