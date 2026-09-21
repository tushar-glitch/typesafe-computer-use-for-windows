using System.Text.Json;
using JevSidecar.Native;
using JevSidecar.Protocol;

namespace JevSidecar.Commands;

/// <summary>
/// The fast path: starting, focusing and navigating applications.
///
/// None of these read the screen. They are the reason a spoken "open chrome"
/// can complete before the sentence does, where the same outcome via the
/// perception loop would cost several seconds per step.
/// </summary>
internal static class AppCommands
{
    public static IEnumerable<ICommandHandler> All() =>
    [
        new LaunchAppCommand(),
        new OpenUrlCommand(),
        new ActivateAppCommand(),
    ];
}

internal sealed record LaunchDto(bool Started);

internal sealed record ActivateDto(bool Activated);

internal sealed class LaunchAppCommand : ICommandHandler
{
    public string Name => "launch_app";

    public object Execute(JsonElement parameters) =>
        new LaunchDto(AppLauncher.Launch(ParamReader.RequiredString(parameters, "appId")));
}

internal sealed class OpenUrlCommand : ICommandHandler
{
    public string Name => "open_url";

    public object Execute(JsonElement parameters) =>
        new LaunchDto(AppLauncher.OpenUrl(ParamReader.RequiredString(parameters, "url")));
}

internal sealed class ActivateAppCommand : ICommandHandler
{
    public string Name => "activate_app";

    public object Execute(JsonElement parameters) =>
        new ActivateDto(AppLauncher.Activate(ParamReader.RequiredString(parameters, "processName")));
}
