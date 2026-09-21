using System.Windows.Automation;

namespace JevSidecar.Native;

/// <summary>
/// UI Automation control types as the one short word the decision model reads.
///
/// The model compares options as text, so "button" must mean the same thing in
/// every app. Anything unmapped becomes "other" rather than leaking a raw
/// control-type name into the criteria.
/// </summary>
internal static class RoleMap
{
    private static readonly Dictionary<int, string> ByControlTypeId = new()
    {
        [ControlType.Button.Id] = "button",
        [ControlType.SplitButton.Id] = "button",
        [ControlType.Hyperlink.Id] = "link",
        [ControlType.Edit.Id] = "field",
        [ControlType.Document.Id] = "field",
        [ControlType.CheckBox.Id] = "checkbox",
        [ControlType.RadioButton.Id] = "radio",
        [ControlType.TabItem.Id] = "tab",
        [ControlType.MenuItem.Id] = "menu",
        [ControlType.ListItem.Id] = "list item",
        [ControlType.TreeItem.Id] = "list item",
        [ControlType.DataItem.Id] = "cell",
        [ControlType.Image.Id] = "image",
        [ControlType.Slider.Id] = "slider",
        [ControlType.ComboBox.Id] = "combo",
    };

    /// <summary>Roles whose contents the user types into.</summary>
    private static readonly HashSet<string> EditableRoles = ["field", "combo"];

    public static string For(ControlType? controlType) =>
        controlType is not null && ByControlTypeId.TryGetValue(controlType.Id, out string? word) ? word : "other";

    public static bool IsEditable(string role) => EditableRoles.Contains(role);
}
