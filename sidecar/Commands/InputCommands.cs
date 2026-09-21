using System.Text.Json;
using JevSidecar.Native;
using JevSidecar.Protocol;

namespace JevSidecar.Commands;

/// <summary>
/// Synthetic input.
///
/// Grouped in one file because each handler is a couple of lines of parameter
/// reading over a single call; splitting them across five files would hide the
/// shape of the action set rather than clarify it.
/// </summary>
internal static class InputCommands
{
    /// <summary>Every handler in this group, for registration.</summary>
    public static IEnumerable<ICommandHandler> All() =>
    [
        new ClickCommand(),
        new MoveCursorCommand(),
        new TypeTextCommand(),
        new PressKeyCommand(),
        new ScrollCommand(),
        new ClearFieldCommand(),
    ];
}

/// <summary>Acknowledgement for an action with nothing to report but success.</summary>
internal sealed record ActionAck(bool Ok);

internal sealed class ClickCommand : ICommandHandler
{
    public string Name => "input_click";

    public object Execute(JsonElement parameters)
    {
        SyntheticInput.Click(
            ParamReader.RequiredNumber(parameters, "x"),
            ParamReader.RequiredNumber(parameters, "y"));

        return new ActionAck(true);
    }
}

internal sealed class MoveCursorCommand : ICommandHandler
{
    public string Name => "input_move";

    public object Execute(JsonElement parameters)
    {
        SyntheticInput.MoveTo(
            ParamReader.RequiredNumber(parameters, "x"),
            ParamReader.RequiredNumber(parameters, "y"));

        return new ActionAck(true);
    }
}

internal sealed class TypeTextCommand : ICommandHandler
{
    public string Name => "input_type";

    public object Execute(JsonElement parameters)
    {
        SyntheticInput.TypeText(ParamReader.RequiredString(parameters, "text"));
        return new ActionAck(true);
    }
}

internal sealed class PressKeyCommand : ICommandHandler
{
    public string Name => "input_key";

    public object Execute(JsonElement parameters)
    {
        SyntheticInput.PressKey(ParamReader.RequiredString(parameters, "key"));
        return new ActionAck(true);
    }
}

internal sealed class ScrollCommand : ICommandHandler
{
    public string Name => "input_scroll";

    public object Execute(JsonElement parameters)
    {
        // Positive notches scroll up, matching the Win32 wheel convention.
        SyntheticInput.Scroll((int)ParamReader.RequiredNumber(parameters, "notches"));
        return new ActionAck(true);
    }
}

internal sealed class ClearFieldCommand : ICommandHandler
{
    public string Name => "input_clear_field";

    public object Execute(JsonElement parameters)
    {
        SyntheticInput.ClearFocusedField();
        return new ActionAck(true);
    }
}
