using System.Text.Json;
using Interop.UIAutomationClient;
using JevSidecar.Native;
using JevSidecar.Protocol;

namespace JevSidecar.Commands;

/// <summary>
/// Just the element holding keyboard focus.
///
/// A whole tree walk costs about 400ms and is the wrong price to pay for one
/// question: is there somewhere to type? GetFocusedElement is a single call,
/// so anything that only needs the caret can ask cheaply.
/// </summary>
internal sealed class FocusedFieldCommand : ICommandHandler
{
    private readonly ElementRegistry _registry;

    public FocusedFieldCommand(ElementRegistry registry) => _registry = registry;

    public string Name => "focused_field";

    public object Execute(JsonElement parameters)
    {
        IUIAutomation automation = new CUIAutomation8();
        FocusedFieldDto? field = UiaWalker.ReadFocusedField(automation, _registry);

        return new { field };
    }
}
