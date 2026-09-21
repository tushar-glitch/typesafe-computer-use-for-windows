using System.Windows.Automation;

namespace JevSidecar.Native;

/// <summary>
/// Keeps automation elements alive between the walk that found them and the
/// command that acts on one.
///
/// The TypeScript side holds only an opaque string. Elements are grouped by
/// generation — one per walk — and only the two most recent generations are
/// retained, so a handle from the observation the agent is acting on still
/// resolves while older ones are released rather than pinning dead UI forever.
/// </summary>
internal sealed class ElementRegistry
{
    private const int RetainedGenerations = 2;

    private readonly Dictionary<long, Dictionary<string, AutomationElement>> _generations = [];
    private long _generation;
    private long _counter;

    /// <summary>Starts a new generation and retires the oldest. Returns its id.</summary>
    public long BeginGeneration()
    {
        _generation++;
        _generations[_generation] = [];

        foreach (long stale in _generations.Keys.Where(key => key <= _generation - RetainedGenerations).ToList())
        {
            _ = _generations.Remove(stale);
        }

        return _generation;
    }

    public string Add(AutomationElement element)
    {
        string handle = $"e{++_counter}";
        _generations[_generation][handle] = element;
        return handle;
    }

    /// <summary>The element behind a handle, or null once its generation has been retired.</summary>
    public AutomationElement? Resolve(string handle)
    {
        foreach (Dictionary<string, AutomationElement> generation in _generations.Values)
        {
            if (generation.TryGetValue(handle, out AutomationElement? element))
            {
                return element;
            }
        }

        return null;
    }
}
