using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using OpenApiVisualizer.Models;

namespace OpenApiVisualizer.Services;

public sealed class OpenApiSpecStore
{
    internal static readonly HashSet<string> HttpMethods = new(StringComparer.OrdinalIgnoreCase)
    {
        "get", "put", "post", "delete", "patch", "head", "options", "trace"
    };

    private readonly ConcurrentDictionary<string, OpenApiIndex> _specs = new(StringComparer.Ordinal);

    public string? CurrentSpecId { get; private set; }

    public Task<SpecSummary> ImportAsync(Stream stream, string fileName, CancellationToken cancellationToken)
    {
        return ImportAsync(stream, fileName, makeCurrent: true, cancellationToken);
    }

    public Task<SpecSummary> ImportComparisonAsync(Stream stream, string fileName, CancellationToken cancellationToken)
    {
        return ImportAsync(stream, fileName, makeCurrent: false, cancellationToken);
    }

    private async Task<SpecSummary> ImportAsync(Stream stream, string fileName, bool makeCurrent, CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer, cancellationToken);
        var bytes = buffer.ToArray();
        var specId = Convert.ToHexString(SHA256.HashData(bytes))[..16].ToLowerInvariant();

        if (_specs.TryGetValue(specId, out var existing))
        {
            if (makeCurrent)
            {
                CurrentSpecId = specId;
            }

            return existing.Summary;
        }

        var options = new JsonDocumentOptions
        {
            AllowTrailingCommas = true,
            CommentHandling = JsonCommentHandling.Skip,
            MaxDepth = 512
        };

        using var document = JsonDocument.Parse(bytes, options);
        var index = OpenApiIndexBuilder.Build(specId, fileName, document.RootElement);
        _specs[specId] = index;
        if (makeCurrent)
        {
            CurrentSpecId = specId;
        }

        return index.Summary;
    }

    public SpecSummary? GetSummary(string specId)
    {
        return _specs.TryGetValue(specId, out var index) ? index.Summary : null;
    }

    public IReadOnlyList<EndpointInfo> SearchEndpoints(string specId, string? query, string? method, int limit)
    {
        if (!_specs.TryGetValue(specId, out var index))
        {
            return [];
        }

        var normalizedQuery = query?.Trim();
        return index.Endpoints.Values
            .Where(endpoint => string.IsNullOrWhiteSpace(method) ||
                               string.Equals(endpoint.Method, method, StringComparison.OrdinalIgnoreCase))
            .Where(endpoint => string.IsNullOrWhiteSpace(normalizedQuery) ||
                               endpoint.Id.Contains(normalizedQuery, StringComparison.OrdinalIgnoreCase) ||
                               (endpoint.Summary?.Contains(normalizedQuery, StringComparison.OrdinalIgnoreCase) ?? false) ||
                               (endpoint.OperationId?.Contains(normalizedQuery, StringComparison.OrdinalIgnoreCase) ?? false) ||
                               endpoint.Tags.Any(tag => tag.Contains(normalizedQuery, StringComparison.OrdinalIgnoreCase)))
            .OrderBy(endpoint => endpoint.Path, StringComparer.OrdinalIgnoreCase)
            .ThenBy(endpoint => endpoint.Method, StringComparer.OrdinalIgnoreCase)
            .Take(Math.Clamp(limit, 1, 500))
            .ToArray();
    }

    public IReadOnlyList<SchemaInfo> SearchSchemas(string specId, string? query, int limit)
    {
        if (!_specs.TryGetValue(specId, out var index))
        {
            return [];
        }

        var normalizedQuery = query?.Trim();
        return index.Schemas.Values
            .Where(schema => string.IsNullOrWhiteSpace(normalizedQuery) ||
                             schema.Id.Contains(normalizedQuery, StringComparison.OrdinalIgnoreCase) ||
                             schema.Name.Contains(normalizedQuery, StringComparison.OrdinalIgnoreCase) ||
                             (schema.Description?.Contains(normalizedQuery, StringComparison.OrdinalIgnoreCase) ?? false) ||
                             schema.Properties.Any(property => property.Name.Contains(normalizedQuery, StringComparison.OrdinalIgnoreCase)))
            .OrderBy(schema => schema.Name, StringComparer.OrdinalIgnoreCase)
            .Take(Math.Clamp(limit, 1, 500))
            .ToArray();
    }

    public SchemaInfo? GetSchema(string specId, string schemaIdOrName)
    {
        return _specs.TryGetValue(specId, out var index)
            ? index.GetSchema(schemaIdOrName)
            : null;
    }

    public SchemaInfo? GetSchema(string specId, string schemaIdOrName, string? compareSpecId)
    {
        if (string.IsNullOrWhiteSpace(compareSpecId))
        {
            return GetSchema(specId, schemaIdOrName);
        }

        if (!_specs.TryGetValue(specId, out var baseIndex) ||
            !_specs.TryGetValue(compareSpecId, out var compareIndex))
        {
            return null;
        }

        return OpenApiDiffBuilder.GetSchema(baseIndex, compareIndex, schemaIdOrName);
    }

    public SpecDiffSummary? GetDiffSummary(string baseSpecId, string compareSpecId)
    {
        return _specs.TryGetValue(baseSpecId, out var baseIndex) &&
               _specs.TryGetValue(compareSpecId, out var compareIndex)
            ? OpenApiDiffBuilder.BuildSummary(baseIndex, compareIndex)
            : null;
    }

    public GraphResponse BuildGraph(string specId, GraphRequest request)
    {
        if (!_specs.TryGetValue(specId, out var index))
        {
            return new GraphResponse
            {
                Nodes = [],
                Edges = [],
                Cycles = [],
                Warnings = [$"Spec '{specId}' is not loaded."]
            };
        }

        if (!string.IsNullOrWhiteSpace(request.CompareSpecId))
        {
            if (!_specs.TryGetValue(request.CompareSpecId, out var compareIndex))
            {
                return new GraphResponse
                {
                    Nodes = [],
                    Edges = [],
                    Cycles = [],
                    Warnings = [$"Comparison spec '{request.CompareSpecId}' is not loaded."]
                };
            }

            return OpenApiDiffBuilder.BuildGraph(index, compareIndex, request);
        }

        return index.BuildGraph(request);
    }
}

internal sealed class OpenApiIndex
{
    public required SpecSummary Summary { get; init; }
    public required IReadOnlyDictionary<string, EndpointInfo> Endpoints { get; init; }
    public required IReadOnlyDictionary<string, SchemaInfo> Schemas { get; init; }
    public required IReadOnlyDictionary<string, IReadOnlyList<SchemaEdge>> SchemaEdges { get; init; }
    public required IReadOnlyList<CycleInfo> Cycles { get; init; }

    public SchemaInfo? GetSchema(string schemaIdOrName)
    {
        var schemaId = schemaIdOrName.StartsWith("schema:", StringComparison.Ordinal)
            ? schemaIdOrName
            : $"schema:{schemaIdOrName}";

        return Schemas.TryGetValue(schemaId, out var schema) ? schema : null;
    }

    public GraphResponse BuildGraph(GraphRequest request)
    {
        var warnings = new List<string>();
        if (!string.IsNullOrWhiteSpace(request.IncomingSchemaId))
        {
            return BuildIncomingGraph(request);
        }
        if (!string.IsNullOrWhiteSpace(request.OutgoingSchemaId))
        {
            return BuildOutgoingGraph(request);
        }

        var maxNodes = Math.Clamp(request.MaxNodes, 25, 1_000);
        var selectedEndpointIds = request.EndpointIds
            .Where(Endpoints.ContainsKey)
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        var selectedSchemaIds = request.SchemaIds
            .Where(Schemas.ContainsKey)
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        if (selectedEndpointIds.Length == 0 && selectedSchemaIds.Length == 0)
        {
            return new GraphResponse
            {
                Nodes = [],
                Edges = [],
                Cycles = [],
                Warnings = ["Select endpoints or models to visualize."]
            };
        }

        var depth = request.AllReachable ? int.MaxValue : Math.Clamp(request.Depth, 0, 8);
        var nodes = new Dictionary<string, GraphNode>(StringComparer.Ordinal);
        var edges = new Dictionary<string, GraphEdge>(StringComparer.Ordinal);
        var schemaDepth = new Dictionary<string, int>(StringComparer.Ordinal);
        var queue = new Queue<(string SchemaId, int Depth)>();

        foreach (var schemaId in selectedSchemaIds)
        {
            AddSchemaNode(schemaId);
            if (!schemaDepth.TryGetValue(schemaId, out var knownDepth) || knownDepth > 0)
            {
                schemaDepth[schemaId] = 0;
                queue.Enqueue((schemaId, 0));
            }

            if (nodes.Count >= maxNodes)
            {
                warnings.Add($"Graph was capped at {maxNodes} nodes. Increase the node limit or select fewer roots.");
                break;
            }
        }

        foreach (var endpointId in selectedEndpointIds)
        {
            if (nodes.Count >= maxNodes)
            {
                warnings.Add($"Graph was capped at {maxNodes} nodes. Increase the node limit or filter selected roots.");
                break;
            }

            var endpoint = Endpoints[endpointId];
            nodes[endpoint.Id] = new GraphNode
            {
                Id = endpoint.Id,
                Kind = "endpoint",
                Label = endpoint.Path,
                Subtitle = endpoint.Summary ?? endpoint.OperationId,
                Method = endpoint.Method,
                Tags = endpoint.Tags
            };

            foreach (var schemaUse in endpoint.SchemaUses)
            {
                const int endpointSchemaDepth = 1;
                if (!IsVisibleSchema(schemaUse.SchemaId) ||
                    (request.HideErrorResponses && IsErrorResponseUse(schemaUse)) ||
                    endpointSchemaDepth > depth)
                {
                    continue;
                }

                AddSchemaNode(schemaUse.SchemaId);
                AddEdge(endpoint.Id, schemaUse.SchemaId, schemaUse.Kind, schemaUse.Label);

                if (!schemaDepth.TryGetValue(schemaUse.SchemaId, out var knownDepth) || knownDepth > endpointSchemaDepth)
                {
                    schemaDepth[schemaUse.SchemaId] = endpointSchemaDepth;
                    queue.Enqueue((schemaUse.SchemaId, endpointSchemaDepth));
                }
            }
        }

        while (queue.Count > 0)
        {
            if (nodes.Count >= maxNodes)
            {
                warnings.Add($"Graph was capped at {maxNodes} nodes. Increase the node limit or lower depth/filter endpoints.");
                break;
            }

            var (schemaId, currentDepth) = queue.Dequeue();
            if (currentDepth >= depth || !SchemaEdges.TryGetValue(schemaId, out var outgoing))
            {
                continue;
            }

            foreach (var schemaEdge in outgoing)
            {
                var nextDepth = currentDepth + 1;
                if (nextDepth > depth || !IsVisibleSchema(schemaEdge.TargetSchemaId))
                {
                    continue;
                }

                AddSchemaNode(schemaEdge.TargetSchemaId);
                AddEdge(schemaEdge.SourceSchemaId, schemaEdge.TargetSchemaId, schemaEdge.Kind, schemaEdge.Label);

                if ((!schemaDepth.TryGetValue(schemaEdge.TargetSchemaId, out var knownDepth) || nextDepth < knownDepth) &&
                    nextDepth <= depth)
                {
                    schemaDepth[schemaEdge.TargetSchemaId] = nextDepth;
                    queue.Enqueue((schemaEdge.TargetSchemaId, nextDepth));
                }

                if (nodes.Count >= maxNodes)
                {
                    break;
                }
            }
        }

        var visibleSchemaIds = nodes.Values
            .Where(node => node.Kind == "schema")
            .Select(node => node.Id)
            .ToHashSet(StringComparer.Ordinal);

        var visibleCycles = Cycles
            .Where(cycle => cycle.SchemaIds.Any(visibleSchemaIds.Contains))
            .ToArray();

        return new GraphResponse
        {
            Nodes = nodes.Values.ToArray(),
            Edges = edges.Values.ToArray(),
            Cycles = visibleCycles,
            Warnings = warnings.Distinct(StringComparer.Ordinal).ToArray()
        };

        void AddSchemaNode(string schemaId)
        {
            if (nodes.ContainsKey(schemaId) || !IsVisibleSchema(schemaId) || !Schemas.TryGetValue(schemaId, out var schema))
            {
                return;
            }

            nodes[schemaId] = new GraphNode
            {
                Id = schema.Id,
                Kind = "schema",
                Label = schema.Name,
                Subtitle = SchemaSubtitle(schema),
                CycleId = schema.CycleId,
                Properties = request.IncludeProperties ? GraphProperties(schema).Take(60).ToArray() : [],
                EnumValues = request.HideEnums ? [] : schema.EnumValues
            };
        }

        IEnumerable<SchemaPropertyInfo> GraphProperties(SchemaInfo schema)
        {
            if (!request.HideEnums)
            {
                return schema.Properties;
            }

            return schema.Properties.Select(property => new SchemaPropertyInfo
            {
                Name = property.Name,
                Type = property.Type,
                Format = property.Format,
                SourceSchemaId = property.SourceSchemaId,
                SourceSchemaName = property.SourceSchemaName,
                Inherited = property.Inherited,
                Required = property.Required,
                Nullable = property.Nullable,
                RefId = property.RefId,
                ItemsRefId = property.ItemsRefId,
                EnumValues = []
            });
        }

        void AddEdge(string source, string target, string kind, string label)
        {
            var id = $"{source}|{kind}|{label}|{target}";
            edges.TryAdd(id, new GraphEdge
            {
                Id = id,
                Source = source,
                Target = target,
                Kind = kind,
                Label = label
            });
        }

        bool IsVisibleSchema(string schemaId)
        {
            return Schemas.TryGetValue(schemaId, out var schema) &&
                   (!request.HideEnums || schema.EnumValues.Count == 0);
        }

    }

    private GraphResponse BuildIncomingGraph(GraphRequest request)
    {
        var warnings = new List<string>();
        var rootSchemaId = request.IncomingSchemaId!.StartsWith("schema:", StringComparison.Ordinal)
            ? request.IncomingSchemaId
            : $"schema:{request.IncomingSchemaId}";

        if (!Schemas.ContainsKey(rootSchemaId))
        {
            return new GraphResponse
            {
                Nodes = [],
                Edges = [],
                Cycles = [],
                Warnings = [$"Model '{request.IncomingSchemaId}' was not found."]
            };
        }

        var depth = request.AllReachable ? int.MaxValue : Math.Clamp(request.Depth, 0, 8);
        var maxNodes = Math.Clamp(request.MaxNodes, 25, 1_000);
        var nodes = new Dictionary<string, GraphNode>(StringComparer.Ordinal);
        var edges = new Dictionary<string, GraphEdge>(StringComparer.Ordinal);
        var schemaDepth = new Dictionary<string, int>(StringComparer.Ordinal) { [rootSchemaId] = 0 };
        var queue = new Queue<(string SchemaId, int Depth)>();
        queue.Enqueue((rootSchemaId, 0));
        AddSchemaNode(rootSchemaId);

        var incomingByTarget = SchemaEdges.Values
            .SelectMany(x => x)
            .GroupBy(edge => edge.TargetSchemaId, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.ToArray(), StringComparer.Ordinal);

        while (queue.Count > 0)
        {
            if (nodes.Count >= maxNodes)
            {
                warnings.Add($"Graph was capped at {maxNodes} nodes. Increase the node limit or lower depth.");
                break;
            }

            var (schemaId, currentDepth) = queue.Dequeue();
            if (currentDepth >= depth || !incomingByTarget.TryGetValue(schemaId, out var incoming))
            {
                continue;
            }

            foreach (var schemaEdge in incoming)
            {
                var nextDepth = currentDepth + 1;
                if (nextDepth > depth || !IsVisibleSchema(schemaEdge.SourceSchemaId))
                {
                    continue;
                }

                AddSchemaNode(schemaEdge.SourceSchemaId);
                AddEdge(schemaEdge.SourceSchemaId, schemaEdge.TargetSchemaId, schemaEdge.Kind, schemaEdge.Label);

                if ((!schemaDepth.TryGetValue(schemaEdge.SourceSchemaId, out var knownDepth) || nextDepth < knownDepth) &&
                    nextDepth <= depth)
                {
                    schemaDepth[schemaEdge.SourceSchemaId] = nextDepth;
                    queue.Enqueue((schemaEdge.SourceSchemaId, nextDepth));
                }

                if (nodes.Count >= maxNodes)
                {
                    break;
                }
            }
        }

        var visibleSchemaIds = nodes.Values
            .Where(node => node.Kind == "schema")
            .Select(node => node.Id)
            .ToHashSet(StringComparer.Ordinal);

        foreach (var endpoint in Endpoints.Values)
        {
            if (nodes.Count >= maxNodes)
            {
                warnings.Add($"Graph was capped at {maxNodes} nodes. Increase the node limit or lower depth.");
                break;
            }

            var visibleUses = endpoint.SchemaUses
                .Where(use => visibleSchemaIds.Contains(use.SchemaId))
                .Where(use => !request.HideErrorResponses || !IsErrorResponseUse(use))
                .ToArray();
            if (visibleUses.Length == 0)
            {
                continue;
            }

            nodes[endpoint.Id] = new GraphNode
            {
                Id = endpoint.Id,
                Kind = "endpoint",
                Label = endpoint.Path,
                Subtitle = endpoint.Summary ?? endpoint.OperationId,
                Method = endpoint.Method,
                Tags = endpoint.Tags
            };

            foreach (var schemaUse in visibleUses)
            {
                AddEdge(endpoint.Id, schemaUse.SchemaId, schemaUse.Kind, schemaUse.Label);
            }
        }

        var visibleCycles = Cycles
            .Where(cycle => cycle.SchemaIds.Any(visibleSchemaIds.Contains))
            .ToArray();

        return new GraphResponse
        {
            Nodes = nodes.Values.ToArray(),
            Edges = edges.Values.ToArray(),
            Cycles = visibleCycles,
            Warnings = warnings.Distinct(StringComparer.Ordinal).ToArray()
        };

        void AddSchemaNode(string schemaId)
        {
            if (nodes.ContainsKey(schemaId) || !IsVisibleSchema(schemaId) || !Schemas.TryGetValue(schemaId, out var schema))
            {
                return;
            }

            nodes[schemaId] = new GraphNode
            {
                Id = schema.Id,
                Kind = "schema",
                Label = schema.Name,
                Subtitle = SchemaSubtitle(schema),
                CycleId = schema.CycleId,
                Properties = request.IncludeProperties ? GraphProperties(schema).Take(60).ToArray() : [],
                EnumValues = request.HideEnums ? [] : schema.EnumValues
            };
        }

        IEnumerable<SchemaPropertyInfo> GraphProperties(SchemaInfo schema)
        {
            if (!request.HideEnums)
            {
                return schema.Properties;
            }

            return schema.Properties.Select(property => new SchemaPropertyInfo
            {
                Name = property.Name,
                Type = property.Type,
                Format = property.Format,
                SourceSchemaId = property.SourceSchemaId,
                SourceSchemaName = property.SourceSchemaName,
                Inherited = property.Inherited,
                Required = property.Required,
                Nullable = property.Nullable,
                RefId = property.RefId,
                ItemsRefId = property.ItemsRefId,
                EnumValues = []
            });
        }

        void AddEdge(string source, string target, string kind, string label)
        {
            var id = $"{source}|{kind}|{label}|{target}";
            edges.TryAdd(id, new GraphEdge
            {
                Id = id,
                Source = source,
                Target = target,
                Kind = kind,
                Label = label
            });
        }

        bool IsVisibleSchema(string schemaId)
        {
            return Schemas.TryGetValue(schemaId, out var schema) &&
                   (!request.HideEnums || schema.EnumValues.Count == 0);
        }

    }

    private GraphResponse BuildOutgoingGraph(GraphRequest request)
    {
        var warnings = new List<string>();
        var rootSchemaId = request.OutgoingSchemaId!.StartsWith("schema:", StringComparison.Ordinal)
            ? request.OutgoingSchemaId
            : $"schema:{request.OutgoingSchemaId}";

        if (!Schemas.ContainsKey(rootSchemaId))
        {
            return new GraphResponse
            {
                Nodes = [],
                Edges = [],
                Cycles = [],
                Warnings = [$"Model '{request.OutgoingSchemaId}' was not found."]
            };
        }

        var depth = request.AllReachable ? int.MaxValue : Math.Clamp(request.Depth, 0, 8);
        var maxNodes = Math.Clamp(request.MaxNodes, 25, 1_000);
        var nodes = new Dictionary<string, GraphNode>(StringComparer.Ordinal);
        var edges = new Dictionary<string, GraphEdge>(StringComparer.Ordinal);
        var schemaDepth = new Dictionary<string, int>(StringComparer.Ordinal) { [rootSchemaId] = 0 };
        var queue = new Queue<(string SchemaId, int Depth)>();
        queue.Enqueue((rootSchemaId, 0));
        AddSchemaNode(rootSchemaId);

        while (queue.Count > 0)
        {
            if (nodes.Count >= maxNodes)
            {
                warnings.Add($"Graph was capped at {maxNodes} nodes. Increase the node limit or lower depth.");
                break;
            }

            var (schemaId, currentDepth) = queue.Dequeue();
            if (currentDepth >= depth || !Schemas.TryGetValue(schemaId, out var schema))
            {
                continue;
            }

            foreach (var schemaEdge in PropertyReferenceEdges(schema))
            {
                var nextDepth = currentDepth + 1;
                if (nextDepth > depth || !IsVisibleSchema(schemaEdge.TargetSchemaId))
                {
                    continue;
                }

                AddSchemaNode(schemaEdge.TargetSchemaId);
                AddEdge(schemaEdge.SourceSchemaId, schemaEdge.TargetSchemaId, schemaEdge.Kind, schemaEdge.Label);

                if ((!schemaDepth.TryGetValue(schemaEdge.TargetSchemaId, out var knownDepth) || nextDepth < knownDepth) &&
                    nextDepth <= depth)
                {
                    schemaDepth[schemaEdge.TargetSchemaId] = nextDepth;
                    queue.Enqueue((schemaEdge.TargetSchemaId, nextDepth));
                }

                if (nodes.Count >= maxNodes)
                {
                    break;
                }
            }
        }

        var visibleSchemaIds = nodes.Values
            .Where(node => node.Kind == "schema")
            .Select(node => node.Id)
            .ToHashSet(StringComparer.Ordinal);

        var visibleCycles = Cycles
            .Where(cycle => cycle.SchemaIds.Any(visibleSchemaIds.Contains))
            .ToArray();

        return new GraphResponse
        {
            Nodes = nodes.Values.ToArray(),
            Edges = edges.Values.ToArray(),
            Cycles = visibleCycles,
            Warnings = warnings.Distinct(StringComparer.Ordinal).ToArray()
        };

        void AddSchemaNode(string schemaId)
        {
            if (nodes.ContainsKey(schemaId) || !IsVisibleSchema(schemaId) || !Schemas.TryGetValue(schemaId, out var schema))
            {
                return;
            }

            nodes[schemaId] = new GraphNode
            {
                Id = schema.Id,
                Kind = "schema",
                Label = schema.Name,
                Subtitle = SchemaSubtitle(schema),
                CycleId = schema.CycleId,
                Properties = request.IncludeProperties ? GraphProperties(schema).Take(60).ToArray() : [],
                EnumValues = request.HideEnums ? [] : schema.EnumValues
            };
        }

        IEnumerable<SchemaPropertyInfo> GraphProperties(SchemaInfo schema)
        {
            if (!request.HideEnums)
            {
                return schema.Properties;
            }

            return schema.Properties.Select(property => new SchemaPropertyInfo
            {
                Name = property.Name,
                Type = property.Type,
                Format = property.Format,
                SourceSchemaId = property.SourceSchemaId,
                SourceSchemaName = property.SourceSchemaName,
                Inherited = property.Inherited,
                Required = property.Required,
                Nullable = property.Nullable,
                RefId = property.RefId,
                ItemsRefId = property.ItemsRefId,
                EnumValues = []
            });
        }

        void AddEdge(string source, string target, string kind, string label)
        {
            var id = $"{source}|{kind}|{label}|{target}";
            edges.TryAdd(id, new GraphEdge
            {
                Id = id,
                Source = source,
                Target = target,
                Kind = kind,
                Label = label
            });
        }

        bool IsVisibleSchema(string schemaId)
        {
            return Schemas.TryGetValue(schemaId, out var schema) &&
                   (!request.HideEnums || schema.EnumValues.Count == 0);
        }
    }

    private static bool IsErrorResponseUse(EndpointSchemaUse schemaUse)
    {
        if (!string.Equals(schemaUse.Kind, "ResponseBody", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var label = schemaUse.Label.TrimStart();
        return label.StartsWith("4", StringComparison.Ordinal) ||
               label.StartsWith("5", StringComparison.Ordinal) ||
               label.StartsWith("default", StringComparison.OrdinalIgnoreCase);
    }

    private static IEnumerable<SchemaEdge> PropertyReferenceEdges(SchemaInfo schema)
    {
        foreach (var property in schema.Properties)
        {
            var targetId = property.ItemsRefId ?? property.RefId;
            if (string.IsNullOrWhiteSpace(targetId))
            {
                continue;
            }

            var inherited = property.Inherited && !string.IsNullOrWhiteSpace(property.SourceSchemaName)
                ? $" (from {property.SourceSchemaName})"
                : "";
            yield return new SchemaEdge
            {
                SourceSchemaId = schema.Id,
                TargetSchemaId = targetId,
                Kind = property.ItemsRefId is null ? "Property" : "ArrayItem",
                Label = $"{property.Name}{inherited}"
            };
        }
    }

    private static string SchemaSubtitle(SchemaInfo schema)
    {
        var type = string.IsNullOrWhiteSpace(schema.Type) ? "schema" : schema.Type;
        var propertyText = schema.Properties.Count == 0
            ? null
            : schema.Properties.Count == 1 ? "1 property" : $"{schema.Properties.Count} properties";
        var enumText = schema.EnumValues.Count == 0
            ? null
            : schema.EnumValues.Count == 1 ? "1 enum value" : $"{schema.EnumValues.Count} enum values";
        var cycleText = schema.CycleId is null ? null : $"cycle {schema.CycleId}";
        return string.Join(" - ", new[] { type, enumText, propertyText, cycleText }.Where(x => !string.IsNullOrWhiteSpace(x)));
    }
}

internal static class OpenApiDiffBuilder
{
    private const string Added = "added";
    private const string Deleted = "deleted";
    private const string Modified = "modified";
    private const string Affected = "affected";
    private const string Unchanged = "unchanged";

    public static SpecDiffSummary BuildSummary(OpenApiIndex baseIndex, OpenApiIndex compareIndex)
    {
        var endpointDiffs = BuildEndpointDiffs(baseIndex, compareIndex);
        var schemaDiffs = BuildSchemaDiffs(baseIndex, compareIndex);
        var edgeDiffs = BuildEdgeDiffs(baseIndex, compareIndex);

        var changedEndpoints = AllEndpointIds(baseIndex, compareIndex)
            .Select(endpointId => EndpointState(endpointId, baseIndex, compareIndex, endpointDiffs, schemaDiffs, edgeDiffs))
            .Where(item => item.State != Unchanged)
            .Select(item => WithEndpointDiff(item.Endpoint, item.State, item.Entries))
            .OrderBy(endpoint => endpoint.Path, StringComparer.OrdinalIgnoreCase)
            .ThenBy(endpoint => endpoint.Method, StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var changedSchemas = AllSchemaIds(baseIndex, compareIndex)
            .Select(schemaId => schemaDiffs.GetValueOrDefault(schemaId))
            .Where(diff => diff is not null && diff.State != Unchanged)
            .Select(diff => WithSchemaDiff(diff!.Item, diff.State, diff.Entries, baseIndex, compareIndex))
            .OrderBy(schema => schema.Name, StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var affectedSchemas = AllSchemaIds(baseIndex, compareIndex)
            .Select(schemaId => SchemaState(schemaId, baseIndex, compareIndex, schemaDiffs, edgeDiffs))
            .Where(diff => diff.State == Affected)
            .Select(diff => WithSchemaDiff(diff.Item, diff.State, diff.Entries, baseIndex, compareIndex))
            .OrderBy(schema => schema.Name, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        return new SpecDiffSummary
        {
            BaseSpecId = baseIndex.Summary.SpecId,
            CompareSpecId = compareIndex.Summary.SpecId,
            CompareSummary = compareIndex.Summary,
            Counts = new DiffCounts
            {
                AddedEndpoints = endpointDiffs.Count(x => x.Value.State == Added),
                DeletedEndpoints = endpointDiffs.Count(x => x.Value.State == Deleted),
                ModifiedEndpoints = endpointDiffs.Count(x => x.Value.State == Modified),
                AddedSchemas = schemaDiffs.Count(x => x.Value.State == Added),
                DeletedSchemas = schemaDiffs.Count(x => x.Value.State == Deleted),
                ModifiedSchemas = schemaDiffs.Count(x => x.Value.State == Modified),
                AddedEdges = edgeDiffs.Count(x => x.Value == Added),
                DeletedEdges = edgeDiffs.Count(x => x.Value == Deleted)
            },
            ChangedEndpoints = changedEndpoints,
            ChangedSchemas = changedSchemas,
            AffectedSchemas = affectedSchemas
        };
    }

    public static SchemaInfo? GetSchema(OpenApiIndex baseIndex, OpenApiIndex compareIndex, string schemaIdOrName)
    {
        var schemaId = schemaIdOrName.StartsWith("schema:", StringComparison.Ordinal)
            ? schemaIdOrName
            : $"schema:{schemaIdOrName}";

        var schemaDiffs = BuildSchemaDiffs(baseIndex, compareIndex);
        if (!schemaDiffs.TryGetValue(schemaId, out var diff))
        {
            return null;
        }

        return WithSchemaDiff(diff.Item, diff.State, diff.Entries, baseIndex, compareIndex);
    }

    public static GraphResponse BuildGraph(OpenApiIndex baseIndex, OpenApiIndex compareIndex, GraphRequest request)
    {
        var baseRequest = CopyRequestFor(
            request,
            request.EndpointIds.Where(baseIndex.Endpoints.ContainsKey),
            request.SchemaIds.Where(baseIndex.Schemas.ContainsKey));
        var compareRequest = CopyRequestFor(
            request,
            request.EndpointIds.Where(compareIndex.Endpoints.ContainsKey),
            request.SchemaIds.Where(compareIndex.Schemas.ContainsKey));
        var baseGraph = baseIndex.BuildGraph(baseRequest);
        var compareGraph = compareIndex.BuildGraph(compareRequest);
        var endpointDiffs = BuildEndpointDiffs(baseIndex, compareIndex);
        var schemaDiffs = BuildSchemaDiffs(baseIndex, compareIndex);
        var edgeDiffs = BuildEdgeDiffs(baseIndex, compareIndex);
        var nodes = new Dictionary<string, GraphNode>(StringComparer.Ordinal);
        var edges = new Dictionary<string, GraphEdge>(StringComparer.Ordinal);

        foreach (var nodeId in baseGraph.Nodes.Select(node => node.Id).Concat(compareGraph.Nodes.Select(node => node.Id)).Distinct(StringComparer.Ordinal))
        {
            var baseNode = baseGraph.Nodes.FirstOrDefault(node => string.Equals(node.Id, nodeId, StringComparison.Ordinal));
            var compareNode = compareGraph.Nodes.FirstOrDefault(node => string.Equals(node.Id, nodeId, StringComparison.Ordinal));
            var node = compareNode ?? baseNode;
            if (node is null)
            {
                continue;
            }

            if (node.Kind == "endpoint")
            {
                var endpointDiff = EndpointState(nodeId, baseIndex, compareIndex, endpointDiffs, schemaDiffs, edgeDiffs);
                if (request.ShowOnlyChanged && endpointDiff.State == Unchanged)
                {
                    continue;
                }

                nodes[nodeId] = WithGraphNodeDiff(node, endpointDiff.State, endpointDiff.Entries, baseIndex, compareIndex);
                continue;
            }

            var schemaDiff = request.ShowOnlyChanged
                ? SchemaState(nodeId, baseIndex, compareIndex, schemaDiffs, edgeDiffs)
                : schemaDiffs.GetValueOrDefault(nodeId) ?? new DiffResult<SchemaInfo>(
                    compareIndex.Schemas.GetValueOrDefault(nodeId) ?? baseIndex.Schemas[nodeId],
                    Unchanged,
                    []);
            if (request.ShowOnlyChanged && schemaDiff.State == Unchanged)
            {
                continue;
            }

            nodes[nodeId] = WithGraphNodeDiff(node, schemaDiff.State, schemaDiff.Entries, baseIndex, compareIndex);
        }

        foreach (var edgeId in baseGraph.Edges.Select(edge => edge.Id).Concat(compareGraph.Edges.Select(edge => edge.Id)).Distinct(StringComparer.Ordinal))
        {
            var baseEdge = baseGraph.Edges.FirstOrDefault(edge => string.Equals(edge.Id, edgeId, StringComparison.Ordinal));
            var compareEdge = compareGraph.Edges.FirstOrDefault(edge => string.Equals(edge.Id, edgeId, StringComparison.Ordinal));
            var edge = compareEdge ?? baseEdge;
            if (edge is null)
            {
                continue;
            }

            if (!nodes.ContainsKey(edge.Source) || !nodes.ContainsKey(edge.Target))
            {
                continue;
            }

            edges[edgeId] = new GraphEdge
            {
                Id = edge.Id,
                Source = edge.Source,
                Target = edge.Target,
                Kind = edge.Kind,
                Label = edge.Label,
                DiffState = edgeDiffs.GetValueOrDefault(edgeId, Unchanged)
            };
        }

        var visibleSchemaIds = nodes.Values
            .Where(node => node.Kind == "schema")
            .Select(node => node.Id)
            .ToHashSet(StringComparer.Ordinal);
        var visibleCycles = baseIndex.Cycles.Concat(compareIndex.Cycles)
            .Where(cycle => cycle.SchemaIds.Any(visibleSchemaIds.Contains))
            .GroupBy(cycle => string.Join("|", cycle.SchemaIds.Order(StringComparer.Ordinal)), StringComparer.Ordinal)
            .Select(group => group.First())
            .ToArray();
        var warnings = baseGraph.Warnings.Concat(compareGraph.Warnings)
            .Where(warning => !warning.Contains("Select at least one endpoint", StringComparison.OrdinalIgnoreCase))
            .Where(warning => !warning.Contains("Select endpoints or models", StringComparison.OrdinalIgnoreCase))
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        return new GraphResponse
        {
            Nodes = nodes.Values.ToArray(),
            Edges = edges.Values.ToArray(),
            Cycles = visibleCycles,
            Warnings = warnings
        };
    }

    private static GraphRequest CopyRequestFor(
        GraphRequest request,
        IEnumerable<string> endpointIds,
        IEnumerable<string> schemaIds)
    {
        return new GraphRequest
        {
            EndpointIds = endpointIds.Distinct(StringComparer.Ordinal).ToArray(),
            SchemaIds = schemaIds.Distinct(StringComparer.Ordinal).ToArray(),
            IncomingSchemaId = request.IncomingSchemaId,
            OutgoingSchemaId = request.OutgoingSchemaId,
            Depth = request.Depth,
            MaxNodes = request.MaxNodes,
            IncludeProperties = request.IncludeProperties,
            AllReachable = request.AllReachable,
            HideEnums = request.HideEnums,
            HideErrorResponses = request.HideErrorResponses,
            ShowOnlyChanged = request.ShowOnlyChanged
        };
    }

    private static IReadOnlyList<string> AllEndpointIds(OpenApiIndex baseIndex, OpenApiIndex compareIndex)
    {
        return baseIndex.Endpoints.Keys
            .Concat(compareIndex.Endpoints.Keys)
            .Distinct(StringComparer.Ordinal)
            .ToArray();
    }

    private static IReadOnlyList<string> AllSchemaIds(OpenApiIndex baseIndex, OpenApiIndex compareIndex)
    {
        return baseIndex.Schemas.Keys
            .Concat(compareIndex.Schemas.Keys)
            .Distinct(StringComparer.Ordinal)
            .ToArray();
    }

    private static EndpointDiffResult EndpointState(
        string endpointId,
        OpenApiIndex baseIndex,
        OpenApiIndex compareIndex,
        IReadOnlyDictionary<string, DiffResult<EndpointInfo>> endpointDiffs,
        IReadOnlyDictionary<string, DiffResult<SchemaInfo>> schemaDiffs,
        IReadOnlyDictionary<string, string> edgeDiffs)
    {
        if (endpointDiffs.TryGetValue(endpointId, out var endpointDiff) && endpointDiff.State != Unchanged)
        {
            return new EndpointDiffResult(endpointDiff.Item, endpointDiff.State, endpointDiff.Entries);
        }

        var endpoint = compareIndex.Endpoints.GetValueOrDefault(endpointId) ?? baseIndex.Endpoints[endpointId];
        var baseReachable = baseIndex.Endpoints.ContainsKey(endpointId) ? ReachableSchemaIdsFromEndpoint(baseIndex, endpointId) : [];
        var compareReachable = compareIndex.Endpoints.ContainsKey(endpointId) ? ReachableSchemaIdsFromEndpoint(compareIndex, endpointId) : [];
        var reachable = baseReachable.Concat(compareReachable).ToHashSet(StringComparer.Ordinal);
        var entries = new List<DiffEntry>();

        foreach (var schemaId in reachable.Order(StringComparer.OrdinalIgnoreCase))
        {
            if (schemaDiffs.TryGetValue(schemaId, out var schemaDiff) && schemaDiff.State != Unchanged)
            {
                entries.Add(new DiffEntry
                {
                    State = schemaDiff.State,
                    Label = "Affected model",
                    Before = schemaDiff.State == Added ? null : StripSchemaPrefix(schemaId),
                    After = schemaDiff.State == Deleted ? null : StripSchemaPrefix(schemaId)
                });
            }
        }

        var reachableEdgeIds = SchemaEdgeIds(baseIndex, baseReachable)
            .Concat(SchemaEdgeIds(compareIndex, compareReachable))
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        foreach (var edgeId in reachableEdgeIds)
        {
            if (edgeDiffs.TryGetValue(edgeId, out var edgeState) && edgeState != Unchanged)
            {
                entries.Add(new DiffEntry
                {
                    State = edgeState,
                    Label = "Affected relationship",
                    Before = edgeState == Added ? null : EdgeLabel(edgeId),
                    After = edgeState == Deleted ? null : EdgeLabel(edgeId)
                });
            }
        }

        return entries.Count == 0
            ? new EndpointDiffResult(endpoint, Unchanged, [])
            : new EndpointDiffResult(endpoint, Affected, entries.Take(16).ToArray());
    }

    private static DiffResult<SchemaInfo> SchemaState(
        string schemaId,
        OpenApiIndex baseIndex,
        OpenApiIndex compareIndex,
        IReadOnlyDictionary<string, DiffResult<SchemaInfo>> schemaDiffs,
        IReadOnlyDictionary<string, string> edgeDiffs)
    {
        if (schemaDiffs.TryGetValue(schemaId, out var schemaDiff) && schemaDiff.State != Unchanged)
        {
            return schemaDiff;
        }

        var schema = compareIndex.Schemas.GetValueOrDefault(schemaId) ?? baseIndex.Schemas.GetValueOrDefault(schemaId);
        if (schema is null)
        {
            throw new InvalidOperationException($"Schema '{schemaId}' is not available in either compared spec.");
        }

        var baseReachable = baseIndex.Schemas.ContainsKey(schemaId) ? ReachableSchemaIdsFromSchema(baseIndex, schemaId) : [];
        var compareReachable = compareIndex.Schemas.ContainsKey(schemaId) ? ReachableSchemaIdsFromSchema(compareIndex, schemaId) : [];
        var reachable = baseReachable.Concat(compareReachable).ToHashSet(StringComparer.Ordinal);
        var entries = new List<DiffEntry>();

        foreach (var affectedSchemaId in reachable.Where(id => !string.Equals(id, schemaId, StringComparison.Ordinal)).Order(StringComparer.OrdinalIgnoreCase))
        {
            if (schemaDiffs.TryGetValue(affectedSchemaId, out var affectedDiff) && affectedDiff.State != Unchanged)
            {
                entries.Add(new DiffEntry
                {
                    State = affectedDiff.State,
                    Label = "Affected model",
                    Before = affectedDiff.State == Added ? null : StripSchemaPrefix(affectedSchemaId),
                    After = affectedDiff.State == Deleted ? null : StripSchemaPrefix(affectedSchemaId)
                });
            }
        }

        var relatedEdgeIds = SchemaEdgeIdsTouching(baseIndex, reachable)
            .Concat(SchemaEdgeIdsTouching(compareIndex, reachable))
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        foreach (var edgeId in relatedEdgeIds)
        {
            if (edgeDiffs.TryGetValue(edgeId, out var edgeState) && edgeState != Unchanged)
            {
                entries.Add(new DiffEntry
                {
                    State = edgeState,
                    Label = "Affected relationship",
                    Before = edgeState == Added ? null : EdgeLabel(edgeId),
                    After = edgeState == Deleted ? null : EdgeLabel(edgeId)
                });
            }
        }

        return entries.Count == 0
            ? new DiffResult<SchemaInfo>(schema, Unchanged, [])
            : new DiffResult<SchemaInfo>(schema, Affected, entries.Take(16).ToArray());
    }

    private static IReadOnlyDictionary<string, DiffResult<EndpointInfo>> BuildEndpointDiffs(OpenApiIndex baseIndex, OpenApiIndex compareIndex)
    {
        return AllEndpointIds(baseIndex, compareIndex)
            .ToDictionary(
                endpointId => endpointId,
                endpointId =>
                {
                    var hasBase = baseIndex.Endpoints.TryGetValue(endpointId, out var before);
                    var hasCompare = compareIndex.Endpoints.TryGetValue(endpointId, out var after);
                    if (hasCompare && !hasBase)
                    {
                        return new DiffResult<EndpointInfo>(after!, Added, [NewEntry(Added, "Endpoint", null, endpointId)]);
                    }

                    if (hasBase && !hasCompare)
                    {
                        return new DiffResult<EndpointInfo>(before!, Deleted, [NewEntry(Deleted, "Endpoint", endpointId, null)]);
                    }

                    var entries = EndpointEntries(before!, after!);
                    return new DiffResult<EndpointInfo>(after!, entries.Count == 0 ? Unchanged : Modified, entries);
                },
                StringComparer.Ordinal);
    }

    private static IReadOnlyList<DiffEntry> EndpointEntries(EndpointInfo before, EndpointInfo after)
    {
        var entries = new List<DiffEntry>();
        AddChanged(entries, "Summary", before.Summary, after.Summary);
        AddChanged(entries, "Operation ID", before.OperationId, after.OperationId);
        AddSetChanges(entries, "Tag", before.Tags, after.Tags);
        AddSetChanges(entries, "Schema use", before.SchemaUses.Select(SchemaUseSignature), after.SchemaUses.Select(SchemaUseSignature));
        return entries;
    }

    private static IReadOnlyDictionary<string, DiffResult<SchemaInfo>> BuildSchemaDiffs(OpenApiIndex baseIndex, OpenApiIndex compareIndex)
    {
        return baseIndex.Schemas.Keys
            .Concat(compareIndex.Schemas.Keys)
            .Distinct(StringComparer.Ordinal)
            .ToDictionary(
                schemaId => schemaId,
                schemaId =>
                {
                    var hasBase = baseIndex.Schemas.TryGetValue(schemaId, out var before);
                    var hasCompare = compareIndex.Schemas.TryGetValue(schemaId, out var after);
                    if (hasCompare && !hasBase)
                    {
                        return new DiffResult<SchemaInfo>(after!, Added, [NewEntry(Added, "Model", null, StripSchemaPrefix(schemaId))]);
                    }

                    if (hasBase && !hasCompare)
                    {
                        return new DiffResult<SchemaInfo>(before!, Deleted, [NewEntry(Deleted, "Model", StripSchemaPrefix(schemaId), null)]);
                    }

                    var entries = SchemaEntries(before!, after!);
                    return new DiffResult<SchemaInfo>(after!, entries.Count == 0 ? Unchanged : Modified, entries);
                },
                StringComparer.Ordinal);
    }

    private static IReadOnlyList<DiffEntry> SchemaEntries(SchemaInfo before, SchemaInfo after)
    {
        var entries = new List<DiffEntry>();
        AddChanged(entries, "Type", SchemaType(before), SchemaType(after));
        AddChanged(entries, "Description", before.Description, after.Description);
        AddSetChanges(entries, "Enum value", before.EnumValues, after.EnumValues);

        var beforeProps = before.Properties.ToDictionary(prop => prop.Name, StringComparer.Ordinal);
        var afterProps = after.Properties.ToDictionary(prop => prop.Name, StringComparer.Ordinal);
        foreach (var propertyName in beforeProps.Keys.Concat(afterProps.Keys).Distinct(StringComparer.Ordinal).Order(StringComparer.OrdinalIgnoreCase))
        {
            var hasBefore = beforeProps.TryGetValue(propertyName, out var beforeProp);
            var hasAfter = afterProps.TryGetValue(propertyName, out var afterProp);
            if (hasAfter && !hasBefore)
            {
                entries.Add(NewEntry(Added, "Property", null, $"{propertyName}: {PropertySignature(afterProp!)}"));
            }
            else if (hasBefore && !hasAfter)
            {
                entries.Add(NewEntry(Deleted, "Property", $"{propertyName}: {PropertySignature(beforeProp!)}", null));
            }
            else if (!string.Equals(PropertySignature(beforeProp!), PropertySignature(afterProp!), StringComparison.Ordinal))
            {
                entries.Add(NewEntry(Modified, $"Property {propertyName}", PropertySignature(beforeProp!), PropertySignature(afterProp!)));
            }
        }

        return entries;
    }

    private static IReadOnlyDictionary<string, string> BuildEdgeDiffs(OpenApiIndex baseIndex, OpenApiIndex compareIndex)
    {
        var baseEdges = AllGraphEdgeIds(baseIndex);
        var compareEdges = AllGraphEdgeIds(compareIndex);
        return baseEdges.Concat(compareEdges)
            .Distinct(StringComparer.Ordinal)
            .ToDictionary(
                edgeId => edgeId,
                edgeId =>
                {
                    var inBase = baseEdges.Contains(edgeId);
                    var inCompare = compareEdges.Contains(edgeId);
                    if (inCompare && !inBase)
                    {
                        return Added;
                    }

                    if (inBase && !inCompare)
                    {
                        return Deleted;
                    }

                    return Unchanged;
                },
                StringComparer.Ordinal);
    }

    private static HashSet<string> AllGraphEdgeIds(OpenApiIndex index)
    {
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var endpoint in index.Endpoints.Values)
        {
            foreach (var use in endpoint.SchemaUses)
            {
                ids.Add(GraphEdgeId(endpoint.Id, use.Kind, use.Label, use.SchemaId));
            }
        }

        foreach (var edge in index.SchemaEdges.Values.SelectMany(x => x))
        {
            ids.Add(GraphEdgeId(edge.SourceSchemaId, edge.Kind, edge.Label, edge.TargetSchemaId));
        }

        return ids;
    }

    private static IReadOnlyCollection<string> ReachableSchemaIdsFromEndpoint(OpenApiIndex index, string endpointId)
    {
        if (!index.Endpoints.TryGetValue(endpointId, out var endpoint))
        {
            return [];
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var queue = new Queue<string>();
        foreach (var schemaUse in endpoint.SchemaUses)
        {
            if (seen.Add(schemaUse.SchemaId))
            {
                queue.Enqueue(schemaUse.SchemaId);
            }
        }

        WalkReachableSchemas(index, seen, queue);
        return seen;
    }

    private static IReadOnlyCollection<string> ReachableSchemaIdsFromSchema(OpenApiIndex index, string schemaId)
    {
        if (!index.Schemas.ContainsKey(schemaId))
        {
            return [];
        }

        var seen = new HashSet<string>(StringComparer.Ordinal) { schemaId };
        var queue = new Queue<string>();
        queue.Enqueue(schemaId);
        WalkReachableSchemas(index, seen, queue);
        return seen;
    }

    private static void WalkReachableSchemas(OpenApiIndex index, HashSet<string> seen, Queue<string> queue)
    {
        while (queue.Count > 0)
        {
            var schemaId = queue.Dequeue();
            if (!index.SchemaEdges.TryGetValue(schemaId, out var outgoing))
            {
                continue;
            }

            foreach (var edge in outgoing)
            {
                if (seen.Add(edge.TargetSchemaId))
                {
                    queue.Enqueue(edge.TargetSchemaId);
                }
            }
        }
    }

    private static IEnumerable<string> SchemaEdgeIds(OpenApiIndex index, IReadOnlyCollection<string> reachableSchemaIds)
    {
        foreach (var schemaId in reachableSchemaIds)
        {
            if (!index.SchemaEdges.TryGetValue(schemaId, out var outgoing))
            {
                continue;
            }

            foreach (var edge in outgoing.Where(edge => reachableSchemaIds.Contains(edge.TargetSchemaId)))
            {
                yield return GraphEdgeId(edge.SourceSchemaId, edge.Kind, edge.Label, edge.TargetSchemaId);
            }
        }
    }

    private static IEnumerable<string> SchemaEdgeIdsTouching(OpenApiIndex index, IReadOnlyCollection<string> reachableSchemaIds)
    {
        foreach (var endpoint in index.Endpoints.Values)
        {
            foreach (var use in endpoint.SchemaUses.Where(use => reachableSchemaIds.Contains(use.SchemaId)))
            {
                yield return GraphEdgeId(endpoint.Id, use.Kind, use.Label, use.SchemaId);
            }
        }

        foreach (var edge in index.SchemaEdges.Values.SelectMany(x => x))
        {
            if (reachableSchemaIds.Contains(edge.SourceSchemaId) || reachableSchemaIds.Contains(edge.TargetSchemaId))
            {
                yield return GraphEdgeId(edge.SourceSchemaId, edge.Kind, edge.Label, edge.TargetSchemaId);
            }
        }
    }

    private static EndpointInfo WithEndpointDiff(EndpointInfo endpoint, string state, IReadOnlyList<DiffEntry> entries)
    {
        return new EndpointInfo
        {
            Id = endpoint.Id,
            Method = endpoint.Method,
            Path = endpoint.Path,
            Summary = endpoint.Summary,
            OperationId = endpoint.OperationId,
            Tags = endpoint.Tags,
            SchemaUses = endpoint.SchemaUses,
            DiffState = state,
            DiffEntries = entries
        };
    }

    private static SchemaInfo WithSchemaDiff(
        SchemaInfo schema,
        string state,
        IReadOnlyList<DiffEntry> entries,
        OpenApiIndex baseIndex,
        OpenApiIndex compareIndex)
    {
        return new SchemaInfo
        {
            Id = schema.Id,
            Name = schema.Name,
            Type = schema.Type,
            Format = schema.Format,
            Description = schema.Description,
            Properties = DiffProperties(schema.Id, baseIndex, compareIndex),
            EnumValues = schema.EnumValues,
            OutgoingReferenceCount = schema.OutgoingReferenceCount,
            IncomingReferenceCount = schema.IncomingReferenceCount,
            CycleId = schema.CycleId,
            DiffState = state,
            DiffEntries = entries
        };
    }

    private static GraphNode WithGraphNodeDiff(
        GraphNode node,
        string state,
        IReadOnlyList<DiffEntry> entries,
        OpenApiIndex baseIndex,
        OpenApiIndex compareIndex)
    {
        var properties = node.Kind == "schema"
            ? DiffProperties(node.Id, baseIndex, compareIndex)
            : node.Properties;

        return new GraphNode
        {
            Id = node.Id,
            Kind = node.Kind,
            Label = node.Label,
            Subtitle = node.Subtitle,
            Method = node.Method,
            CycleId = node.CycleId,
            Properties = properties,
            EnumValues = node.EnumValues,
            Tags = node.Tags,
            DiffState = state,
            DiffEntries = entries
        };
    }

    private static IReadOnlyList<SchemaPropertyInfo> DiffProperties(string schemaId, OpenApiIndex baseIndex, OpenApiIndex compareIndex)
    {
        var before = baseIndex.Schemas.GetValueOrDefault(schemaId)?.Properties ?? [];
        var after = compareIndex.Schemas.GetValueOrDefault(schemaId)?.Properties ?? [];
        var beforeByName = before.ToDictionary(prop => prop.Name, StringComparer.Ordinal);
        var afterByName = after.ToDictionary(prop => prop.Name, StringComparer.Ordinal);
        var result = new List<SchemaPropertyInfo>();

        foreach (var prop in after)
        {
            var state = beforeByName.TryGetValue(prop.Name, out var beforeProp)
                ? string.Equals(PropertySignature(beforeProp), PropertySignature(prop), StringComparison.Ordinal) ? Unchanged : Modified
                : Added;
            result.Add(WithPropertyDiff(prop, state, beforeProp));
        }

        foreach (var prop in before.Where(prop => !afterByName.ContainsKey(prop.Name)))
        {
            result.Add(WithPropertyDiff(prop, Deleted, prop));
        }

        return result;
    }

    private static SchemaPropertyInfo WithPropertyDiff(SchemaPropertyInfo property, string state, SchemaPropertyInfo? before)
    {
        return new SchemaPropertyInfo
        {
            Name = property.Name,
            Type = property.Type,
            Format = property.Format,
            SourceSchemaId = property.SourceSchemaId,
            SourceSchemaName = property.SourceSchemaName,
            Inherited = property.Inherited,
            Required = property.Required,
            Nullable = property.Nullable,
            RefId = property.RefId,
            ItemsRefId = property.ItemsRefId,
            EnumValues = property.EnumValues,
            DiffState = state,
            PreviousType = state == Modified && before is not null &&
                           !string.Equals(PropertyDisplayType(before), PropertyDisplayType(property), StringComparison.Ordinal)
                ? PropertyDisplayType(before)
                : null,
            PreviousRequired = state == Modified && before is not null && before.Required != property.Required
                ? before.Required
                : null
        };
    }

    private static string GraphEdgeId(string source, string kind, string label, string target)
    {
        return $"{source}|{kind}|{label}|{target}";
    }

    private static string SchemaUseSignature(EndpointSchemaUse use)
    {
        return $"{use.Kind} {use.Label} {StripSchemaPrefix(use.SchemaId)}";
    }

    private static string PropertySignature(SchemaPropertyInfo property)
    {
        var type = PropertyDisplayType(property);
        var required = property.Required ? "required" : "optional";
        var nullable = property.Nullable ? ", nullable" : "";
        var enums = property.EnumValues.Count == 0 ? "" : $", enum: {string.Join(", ", property.EnumValues)}";
        return $"{type} ({required}{nullable}{enums})";
    }

    private static string PropertyDisplayType(SchemaPropertyInfo property)
    {
        if (property.ItemsRefId is not null)
        {
            return $"{StripSchemaPrefix(property.ItemsRefId)}[]";
        }

        if (property.RefId is not null)
        {
            return StripSchemaPrefix(property.RefId);
        }

        if (property.EnumValues.Count > 0)
        {
            return $"enum({property.EnumValues.Count})";
        }

        if (!string.IsNullOrWhiteSpace(property.Format))
        {
            return $"{property.Type ?? "value"}:{property.Format}";
        }

        return property.Type ?? "value";
    }

    private static string SchemaType(SchemaInfo schema)
    {
        return SchemaType(schema.Type, schema.Format);
    }

    private static string SchemaType(string? type, string? format)
    {
        return string.Join(" ", new[] { type, format }.Where(value => !string.IsNullOrWhiteSpace(value)));
    }

    private static void AddChanged(List<DiffEntry> entries, string label, string? before, string? after)
    {
        if (!string.Equals(before ?? "", after ?? "", StringComparison.Ordinal))
        {
            entries.Add(NewEntry(Modified, label, before, after));
        }
    }

    private static void AddSetChanges(List<DiffEntry> entries, string label, IEnumerable<string> before, IEnumerable<string> after)
    {
        var beforeSet = before.ToHashSet(StringComparer.Ordinal);
        var afterSet = after.ToHashSet(StringComparer.Ordinal);
        foreach (var value in afterSet.Except(beforeSet, StringComparer.Ordinal).Order(StringComparer.OrdinalIgnoreCase))
        {
            entries.Add(NewEntry(Added, label, null, value));
        }

        foreach (var value in beforeSet.Except(afterSet, StringComparer.Ordinal).Order(StringComparer.OrdinalIgnoreCase))
        {
            entries.Add(NewEntry(Deleted, label, value, null));
        }
    }

    private static DiffEntry NewEntry(string state, string label, string? before, string? after)
    {
        return new DiffEntry
        {
            State = state,
            Label = label,
            Before = string.IsNullOrWhiteSpace(before) ? null : before,
            After = string.IsNullOrWhiteSpace(after) ? null : after
        };
    }

    private static string StripSchemaPrefix(string value)
    {
        return value.StartsWith("schema:", StringComparison.Ordinal) ? value["schema:".Length..] : value;
    }

    private static string EdgeLabel(string edgeId)
    {
        var parts = edgeId.Split('|');
        return parts.Length == 4
            ? $"{StripSchemaPrefix(parts[0])} -> {StripSchemaPrefix(parts[3])} ({parts[2]})"
            : edgeId;
    }

    private sealed record DiffResult<T>(T Item, string State, IReadOnlyList<DiffEntry> Entries);

    private sealed record EndpointDiffResult(EndpointInfo Endpoint, string State, IReadOnlyList<DiffEntry> Entries);
}

internal static class OpenApiIndexBuilder
{
    public static OpenApiIndex Build(string specId, string fileName, JsonElement root)
    {
        var schemas = ReadSchemas(root);
        var schemaEdges = ReadSchemaEdges(root, schemas.Keys);
        ApplyIncomingCounts(schemas, schemaEdges);
        var cycles = DetectCycles(schemas, schemaEdges);
        var endpoints = ReadEndpoints(root, schemas.Keys);
        var title = ReadString(root, "info", "title") ?? Path.GetFileNameWithoutExtension(fileName) ?? "OpenAPI Spec";
        var version = ReadString(root, "info", "version") ?? "";

        var summary = new SpecSummary
        {
            SpecId = specId,
            Title = title,
            Version = version,
            EndpointCount = endpoints.Count,
            SchemaCount = schemas.Count,
            CycleCount = cycles.Count,
            ImportedAt = DateTimeOffset.UtcNow
        };

        return new OpenApiIndex
        {
            Summary = summary,
            Endpoints = endpoints.ToDictionary(endpoint => endpoint.Id, StringComparer.Ordinal),
            Schemas = schemas,
            SchemaEdges = schemaEdges.ToDictionary(x => x.Key, x => (IReadOnlyList<SchemaEdge>)x.Value, StringComparer.Ordinal),
            Cycles = cycles
        };
    }

    private static Dictionary<string, SchemaInfo> ReadSchemas(JsonElement root)
    {
        var schemas = new Dictionary<string, SchemaInfo>(StringComparer.Ordinal);
        if (!TryGetSchemas(root, out var schemasElement))
        {
            return schemas;
        }

        foreach (var schemaProperty in schemasElement.EnumerateObject())
        {
            var schema = schemaProperty.Value;
            var id = SchemaId(schemaProperty.Name);
            schemas[id] = new SchemaInfo
            {
                Id = id,
                Name = schemaProperty.Name,
                Type = ReadType(schema),
                Format = ReadString(schema, "format"),
                Description = ReadString(schema, "description"),
                Properties = ReadSchemaProperties(root, schemaProperty.Name, schema),
                EnumValues = ReadEnumValues(schema)
            };
        }

        return schemas;
    }

    private static IReadOnlyList<SchemaPropertyInfo> ReadSchemaProperties(JsonElement root, string schemaName, JsonElement schema)
    {
        var schemaId = SchemaId(schemaName);
        var properties = new List<SchemaPropertyInfo>();
        var seenSchemaIds = new HashSet<string>(StringComparer.Ordinal) { schemaId };

        AddAllOfProperties(root, schema, schemaId, schemaName, properties, seenSchemaIds);
        AddDirectProperties(schema, schemaId, schemaName, inherited: false, properties);
        return properties;
    }

    private static void AddAllOfProperties(
        JsonElement root,
        JsonElement schema,
        string owningSchemaId,
        string owningSchemaName,
        List<SchemaPropertyInfo> properties,
        HashSet<string> seenSchemaIds)
    {
        if (schema.ValueKind != JsonValueKind.Object ||
            !schema.TryGetProperty("allOf", out var allOf) ||
            allOf.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        var inlineIndex = 1;
        foreach (var item in allOf.EnumerateArray())
        {
            if (TryDirectSchemaRef(item, out var parentSchemaId))
            {
                if (!seenSchemaIds.Add(parentSchemaId) || !TryGetSchemaElement(root, parentSchemaId, out var parentSchema))
                {
                    continue;
                }

                AddAllOfProperties(root, parentSchema, parentSchemaId, SchemaName(parentSchemaId), properties, seenSchemaIds);
                AddDirectProperties(parentSchema, parentSchemaId, SchemaName(parentSchemaId), inherited: true, properties);
                continue;
            }

            var inlineName = $"{owningSchemaName} allOf[{inlineIndex}]";
            AddAllOfProperties(root, item, owningSchemaId, owningSchemaName, properties, seenSchemaIds);
            AddDirectProperties(item, owningSchemaId, inlineName, inherited: false, properties);
            inlineIndex++;
        }
    }

    private static void AddDirectProperties(
        JsonElement schema,
        string sourceSchemaId,
        string sourceSchemaName,
        bool inherited,
        List<SchemaPropertyInfo> properties)
    {
        if (schema.ValueKind != JsonValueKind.Object ||
            !schema.TryGetProperty("properties", out var propertiesElement) ||
            propertiesElement.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        var required = ReadStringArray(schema, "required").ToHashSet(StringComparer.Ordinal);
        foreach (var property in propertiesElement.EnumerateObject())
        {
            AddOrReplaceProperty(
                properties,
                ReadPropertyInfo(property.Name, property.Value, required.Contains(property.Name), sourceSchemaId, sourceSchemaName, inherited));
        }
    }

    private static void AddOrReplaceProperty(List<SchemaPropertyInfo> properties, SchemaPropertyInfo property)
    {
        var existingIndex = properties.FindIndex(existing => string.Equals(existing.Name, property.Name, StringComparison.Ordinal));
        if (existingIndex < 0)
        {
            properties.Add(property);
            return;
        }

        if (!property.Inherited || properties[existingIndex].Inherited)
        {
            properties[existingIndex] = property;
        }
    }

    private static Dictionary<string, List<SchemaEdge>> ReadSchemaEdges(JsonElement root, IReadOnlyCollection<string> knownSchemaIds)
    {
        var edges = knownSchemaIds.ToDictionary(schemaId => schemaId, _ => new List<SchemaEdge>(), StringComparer.Ordinal);
        if (!TryGetSchemas(root, out var schemasElement))
        {
            return edges;
        }

        foreach (var schemaProperty in schemasElement.EnumerateObject())
        {
            var sourceId = SchemaId(schemaProperty.Name);
            var seenRefs = new HashSet<string>(StringComparer.Ordinal);
            WalkSchemaForEdges(root, sourceId, schemaProperty.Value, "schema", "Schema", edges[sourceId], seenRefs);
        }

        foreach (var sourceEdges in edges.Values)
        {
            var unique = NormalizeSchemaEdges(sourceEdges);
            sourceEdges.Clear();
            sourceEdges.AddRange(unique);
        }

        foreach (var schemaId in knownSchemaIds)
        {
            if (schemasElement.TryGetProperty(SchemaName(schemaId), out var schema) &&
                schemasElement.ValueKind == JsonValueKind.Object)
            {
                // OutgoingReferenceCount is assigned by replacing the immutable-like object below.
            }
        }

        return edges;
    }

    private static IReadOnlyList<SchemaEdge> NormalizeSchemaEdges(IEnumerable<SchemaEdge> edges)
    {
        return edges
            .GroupBy(edge => $"{edge.SourceSchemaId}|{edge.TargetSchemaId}", StringComparer.Ordinal)
            .SelectMany(group =>
            {
                var groupedEdges = group.ToArray();
                if (groupedEdges.Any(edge => IsInheritanceEdge(edge.Kind)))
                {
                    var first = groupedEdges[0];
                    return
                    [
                        new SchemaEdge
                        {
                            SourceSchemaId = first.SourceSchemaId,
                            TargetSchemaId = first.TargetSchemaId,
                            Kind = "Inheritance",
                            Label = "inherits"
                        }
                    ];
                }

                return groupedEdges
                    .GroupBy(edge => $"{edge.Kind}|{edge.Label}", StringComparer.Ordinal)
                    .Select(uniqueGroup => uniqueGroup.First());
            })
            .ToArray();
    }

    private static bool IsInheritanceEdge(string kind)
    {
        return string.Equals(kind, "AllOf", StringComparison.Ordinal) ||
               string.Equals(kind, "OneOf", StringComparison.Ordinal) ||
               string.Equals(kind, "AnyOf", StringComparison.Ordinal) ||
               string.Equals(kind, "DiscriminatorMapping", StringComparison.Ordinal);
    }

    private static IReadOnlyList<EndpointInfo> ReadEndpoints(JsonElement root, IReadOnlyCollection<string> knownSchemaIds)
    {
        var endpoints = new List<EndpointInfo>();
        if (!root.TryGetProperty("paths", out var paths) || paths.ValueKind != JsonValueKind.Object)
        {
            return endpoints;
        }

        foreach (var pathProperty in paths.EnumerateObject())
        {
            var path = pathProperty.Name;
            if (pathProperty.Value.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var pathLevelParameters = pathProperty.Value.TryGetProperty("parameters", out var pathParameters)
                ? pathParameters
                : default;

            foreach (var operationProperty in pathProperty.Value.EnumerateObject())
            {
                if (!IsHttpMethod(operationProperty.Name) || operationProperty.Value.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                var operation = operationProperty.Value;
                var method = operationProperty.Name.ToUpperInvariant();
                var id = $"{method} {path}";
                var schemaUses = new List<EndpointSchemaUse>();

                if (operation.TryGetProperty("requestBody", out var requestBody))
                {
                    AddContentSchemaUses(root, requestBody, "RequestBody", "body", schemaUses);
                }

                if (operation.TryGetProperty("responses", out var responses) && responses.ValueKind == JsonValueKind.Object)
                {
                    foreach (var response in responses.EnumerateObject())
                    {
                        AddContentSchemaUses(root, response.Value, "ResponseBody", $"{response.Name} response", schemaUses);
                    }
                }

                AddParameterSchemaUses(root, pathLevelParameters, schemaUses);
                if (operation.TryGetProperty("parameters", out var operationParameters))
                {
                    AddParameterSchemaUses(root, operationParameters, schemaUses);
                }

                schemaUses = schemaUses
                    .Where(use => knownSchemaIds.Contains(use.SchemaId))
                    .GroupBy(use => $"{use.SchemaId}|{use.Kind}|{use.Label}", StringComparer.Ordinal)
                    .Select(group => group.First())
                    .ToList();

                endpoints.Add(new EndpointInfo
                {
                    Id = id,
                    Method = method,
                    Path = path,
                    Summary = ReadString(operation, "summary"),
                    OperationId = ReadString(operation, "operationId"),
                    Tags = ReadStringArray(operation, "tags"),
                    SchemaUses = schemaUses
                });
            }
        }

        return endpoints
            .OrderBy(endpoint => endpoint.Path, StringComparer.OrdinalIgnoreCase)
            .ThenBy(endpoint => endpoint.Method, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static void AddContentSchemaUses(
        JsonElement root,
        JsonElement element,
        string kind,
        string fallbackLabel,
        List<EndpointSchemaUse> schemaUses)
    {
        element = ResolveIfNeeded(root, element);
        if (element.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        if (element.TryGetProperty("content", out var content) && content.ValueKind == JsonValueKind.Object)
        {
            foreach (var mediaType in content.EnumerateObject())
            {
                if (mediaType.Value.ValueKind == JsonValueKind.Object &&
                    mediaType.Value.TryGetProperty("schema", out var schema))
                {
                    foreach (var schemaId in CollectSchemaRefs(root, schema))
                    {
                        schemaUses.Add(new EndpointSchemaUse
                        {
                            SchemaId = schemaId,
                            Kind = kind,
                            Label = kind == "ResponseBody" ? $"{fallbackLabel} - {mediaType.Name}" : mediaType.Name
                        });
                    }
                }
            }
        }
        else if (element.TryGetProperty("schema", out var schema))
        {
            foreach (var schemaId in CollectSchemaRefs(root, schema))
            {
                schemaUses.Add(new EndpointSchemaUse
                {
                    SchemaId = schemaId,
                    Kind = kind,
                    Label = fallbackLabel
                });
            }
        }
    }

    private static void AddParameterSchemaUses(JsonElement root, JsonElement parameters, List<EndpointSchemaUse> schemaUses)
    {
        parameters = ResolveIfNeeded(root, parameters);
        if (parameters.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        foreach (var parameter in parameters.EnumerateArray())
        {
            var resolved = ResolveIfNeeded(root, parameter);
            if (resolved.ValueKind != JsonValueKind.Object || !resolved.TryGetProperty("schema", out var schema))
            {
                continue;
            }

            var name = ReadString(resolved, "name") ?? "parameter";
            var location = ReadString(resolved, "in") ?? "parameter";
            foreach (var schemaId in CollectSchemaRefs(root, schema))
            {
                schemaUses.Add(new EndpointSchemaUse
                {
                    SchemaId = schemaId,
                    Kind = "Parameter",
                    Label = $"{location}: {name}"
                });
            }
        }
    }

    private static IReadOnlyList<string> CollectSchemaRefs(JsonElement root, JsonElement element)
    {
        var refs = new HashSet<string>(StringComparer.Ordinal);
        var seenRefs = new HashSet<string>(StringComparer.Ordinal);

        void Walk(JsonElement current)
        {
            if (current.ValueKind == JsonValueKind.Object &&
                current.TryGetProperty("$ref", out var refElement) &&
                refElement.ValueKind == JsonValueKind.String)
            {
                var refValue = refElement.GetString();
                if (TrySchemaIdFromRef(refValue, out var schemaId))
                {
                    refs.Add(schemaId);
                    return;
                }

                if (refValue is not null && seenRefs.Add(refValue) && TryResolveRef(root, refValue, out var resolved))
                {
                    Walk(resolved);
                }

                return;
            }

            if (current.ValueKind == JsonValueKind.Object)
            {
                foreach (var property in current.EnumerateObject())
                {
                    Walk(property.Value);
                }
            }
            else if (current.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in current.EnumerateArray())
                {
                    Walk(item);
                }
            }
        }

        Walk(element);
        return refs.ToArray();
    }

    private static void WalkSchemaForEdges(
        JsonElement root,
        string sourceId,
        JsonElement element,
        string label,
        string relationKind,
        List<SchemaEdge> edges,
        HashSet<string> seenRefs)
    {
        element = ResolveNonSchemaRef(root, element, seenRefs);

        if (element.ValueKind == JsonValueKind.Object &&
            element.TryGetProperty("$ref", out var refElement) &&
            refElement.ValueKind == JsonValueKind.String &&
            TrySchemaIdFromRef(refElement.GetString(), out var schemaId))
        {
            edges.Add(new SchemaEdge
            {
                SourceSchemaId = sourceId,
                TargetSchemaId = schemaId,
                Kind = relationKind,
                Label = label
            });
            return;
        }

        if (element.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        AddComposedEdges(root, sourceId, element, "allOf", "AllOf", label, edges, seenRefs);
        AddComposedEdges(root, sourceId, element, "oneOf", "OneOf", label, edges, seenRefs);
        AddComposedEdges(root, sourceId, element, "anyOf", "AnyOf", label, edges, seenRefs);

        if (element.TryGetProperty("properties", out var properties) && properties.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in properties.EnumerateObject())
            {
                WalkSchemaForEdges(root, sourceId, property.Value, property.Name, "Property", edges, seenRefs);
            }
        }

        if (element.TryGetProperty("items", out var items))
        {
            WalkSchemaForEdges(root, sourceId, items, $"{label}[]", "ArrayItem", edges, seenRefs);
        }

        if (element.TryGetProperty("additionalProperties", out var additionalProperties) &&
            additionalProperties.ValueKind == JsonValueKind.Object)
        {
            WalkSchemaForEdges(root, sourceId, additionalProperties, $"{label}{{}}", "DictionaryValue", edges, seenRefs);
        }

        if (element.TryGetProperty("discriminator", out var discriminator) &&
            discriminator.ValueKind == JsonValueKind.Object &&
            discriminator.TryGetProperty("mapping", out var mapping) &&
            mapping.ValueKind == JsonValueKind.Object)
        {
            foreach (var mappedType in mapping.EnumerateObject())
            {
                if (mappedType.Value.ValueKind == JsonValueKind.String &&
                    TrySchemaIdFromRef(mappedType.Value.GetString(), out var mappedSchemaId))
                {
                    edges.Add(new SchemaEdge
                    {
                        SourceSchemaId = sourceId,
                        TargetSchemaId = mappedSchemaId,
                        Kind = "DiscriminatorMapping",
                        Label = mappedType.Name
                    });
                }
            }
        }
    }

    private static void AddComposedEdges(
        JsonElement root,
        string sourceId,
        JsonElement element,
        string propertyName,
        string kind,
        string label,
        List<SchemaEdge> edges,
        HashSet<string> seenRefs)
    {
        if (!element.TryGetProperty(propertyName, out var composition) || composition.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        var index = 1;
        foreach (var item in composition.EnumerateArray())
        {
            WalkSchemaForEdges(root, sourceId, item, label == "schema" ? propertyName : $"{label} {propertyName}[{index}]", kind, edges, seenRefs);
            index++;
        }
    }

    private static SchemaPropertyInfo ReadPropertyInfo(
        string name,
        JsonElement property,
        bool required,
        string sourceSchemaId,
        string sourceSchemaName,
        bool inherited)
    {
        var refId = TryDirectSchemaRef(property, out var directRef) ? directRef : null;
        var itemsRef = TryArrayItemsRef(property, out var itemRef) ? itemRef : null;
        return new SchemaPropertyInfo
        {
            Name = name,
            Type = ReadType(property),
            Format = ReadString(property, "format"),
            SourceSchemaId = sourceSchemaId,
            SourceSchemaName = sourceSchemaName,
            Inherited = inherited,
            Required = required,
            Nullable = ReadBool(property, "nullable"),
            RefId = refId,
            ItemsRefId = itemsRef,
            EnumValues = ReadEnumValues(property)
        };
    }

    private static void ApplyIncomingCounts(
        Dictionary<string, SchemaInfo> schemas,
        Dictionary<string, List<SchemaEdge>> edges)
    {
        foreach (var edge in edges.Values.SelectMany(x => x))
        {
            if (schemas.TryGetValue(edge.TargetSchemaId, out var target))
            {
                target.IncomingReferenceCount++;
            }
        }

        foreach (var (schemaId, sourceEdges) in edges)
        {
            if (!schemas.TryGetValue(schemaId, out var schema))
            {
                continue;
            }

            schemas[schemaId] = new SchemaInfo
            {
                Id = schema.Id,
                Name = schema.Name,
                Type = schema.Type,
                Format = schema.Format,
                Description = schema.Description,
                Properties = schema.Properties,
                EnumValues = schema.EnumValues,
                IncomingReferenceCount = schema.IncomingReferenceCount,
                OutgoingReferenceCount = sourceEdges.Count
            };
        }
    }

    private static IReadOnlyList<CycleInfo> DetectCycles(
        Dictionary<string, SchemaInfo> schemas,
        Dictionary<string, List<SchemaEdge>> edges)
    {
        var index = 0;
        var stack = new Stack<string>();
        var onStack = new HashSet<string>(StringComparer.Ordinal);
        var indexes = new Dictionary<string, int>(StringComparer.Ordinal);
        var lowLinks = new Dictionary<string, int>(StringComparer.Ordinal);
        var cycles = new List<CycleInfo>();

        foreach (var schemaId in schemas.Keys)
        {
            if (!indexes.ContainsKey(schemaId))
            {
                StrongConnect(schemaId);
            }
        }

        for (var i = 0; i < cycles.Count; i++)
        {
            foreach (var schemaId in cycles[i].SchemaIds)
            {
                if (schemas.TryGetValue(schemaId, out var schema))
                {
                    schema.CycleId = cycles[i].Id;
                }
            }
        }

        return cycles;

        void StrongConnect(string schemaId)
        {
            indexes[schemaId] = index;
            lowLinks[schemaId] = index;
            index++;
            stack.Push(schemaId);
            onStack.Add(schemaId);

            var outgoing = edges.TryGetValue(schemaId, out var schemaEdges) ? schemaEdges : [];
            foreach (var targetId in outgoing.Select(edge => edge.TargetSchemaId))
            {
                if (!schemas.ContainsKey(targetId))
                {
                    continue;
                }

                if (!indexes.ContainsKey(targetId))
                {
                    StrongConnect(targetId);
                    lowLinks[schemaId] = Math.Min(lowLinks[schemaId], lowLinks[targetId]);
                }
                else if (onStack.Contains(targetId))
                {
                    lowLinks[schemaId] = Math.Min(lowLinks[schemaId], indexes[targetId]);
                }
            }

            if (lowLinks[schemaId] != indexes[schemaId])
            {
                return;
            }

            var component = new List<string>();
            string current;
            do
            {
                current = stack.Pop();
                onStack.Remove(current);
                component.Add(current);
            }
            while (!string.Equals(current, schemaId, StringComparison.Ordinal));

            var selfEdges = edges.TryGetValue(schemaId, out var schemaSelfEdges) ? schemaSelfEdges : [];
            var selfCycle = component.Count == 1 && selfEdges.Any(edge => edge.TargetSchemaId == schemaId);
            if (component.Count > 1 || selfCycle)
            {
                component.Sort(StringComparer.OrdinalIgnoreCase);
                cycles.Add(new CycleInfo
                {
                    Id = cycles.Count + 1,
                    SchemaIds = component
                });
            }
        }
    }

    private static JsonElement ResolveIfNeeded(JsonElement root, JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object &&
            element.TryGetProperty("$ref", out var refElement) &&
            refElement.ValueKind == JsonValueKind.String &&
            TryResolveRef(root, refElement.GetString(), out var resolved))
        {
            return resolved;
        }

        return element;
    }

    private static JsonElement ResolveNonSchemaRef(JsonElement root, JsonElement element, HashSet<string> seenRefs)
    {
        if (element.ValueKind != JsonValueKind.Object ||
            !element.TryGetProperty("$ref", out var refElement) ||
            refElement.ValueKind != JsonValueKind.String)
        {
            return element;
        }

        var refValue = refElement.GetString();
        if (TrySchemaIdFromRef(refValue, out _) || refValue is null || !seenRefs.Add(refValue))
        {
            return element;
        }

        return TryResolveRef(root, refValue, out var resolved) ? resolved : element;
    }

    private static bool TryResolveRef(JsonElement root, string? refValue, out JsonElement resolved)
    {
        resolved = default;
        if (string.IsNullOrWhiteSpace(refValue) || !refValue.StartsWith("#/", StringComparison.Ordinal))
        {
            return false;
        }

        var current = root;
        foreach (var segment in refValue[2..].Split('/'))
        {
            var propertyName = segment.Replace("~1", "/", StringComparison.Ordinal).Replace("~0", "~", StringComparison.Ordinal);
            if (current.ValueKind == JsonValueKind.Object && current.TryGetProperty(propertyName, out var child))
            {
                current = child;
                continue;
            }

            return false;
        }

        resolved = current;
        return true;
    }

    private static bool TryGetSchemas(JsonElement root, out JsonElement schemas)
    {
        schemas = default;
        return root.TryGetProperty("components", out var components) &&
               components.ValueKind == JsonValueKind.Object &&
               components.TryGetProperty("schemas", out schemas) &&
               schemas.ValueKind == JsonValueKind.Object;
    }

    private static bool TryGetSchemaElement(JsonElement root, string schemaId, out JsonElement schema)
    {
        schema = default;
        return TryGetSchemas(root, out var schemas) &&
               schemas.TryGetProperty(SchemaName(schemaId), out schema) &&
               schema.ValueKind == JsonValueKind.Object;
    }

    private static bool TryDirectSchemaRef(JsonElement element, out string schemaId)
    {
        schemaId = "";
        return element.ValueKind == JsonValueKind.Object &&
               element.TryGetProperty("$ref", out var refElement) &&
               refElement.ValueKind == JsonValueKind.String &&
               TrySchemaIdFromRef(refElement.GetString(), out schemaId);
    }

    private static bool TryArrayItemsRef(JsonElement element, out string schemaId)
    {
        schemaId = "";
        return element.ValueKind == JsonValueKind.Object &&
               element.TryGetProperty("items", out var items) &&
               TryDirectSchemaRef(items, out schemaId);
    }

    private static bool TrySchemaIdFromRef(string? refValue, out string schemaId)
    {
        schemaId = "";
        const string prefix = "#/components/schemas/";
        if (string.IsNullOrWhiteSpace(refValue) || !refValue.StartsWith(prefix, StringComparison.Ordinal))
        {
            return false;
        }

        schemaId = SchemaId(Uri.UnescapeDataString(refValue[prefix.Length..]));
        return true;
    }

    private static string SchemaId(string name) => $"schema:{name}";

    private static string SchemaName(string schemaId) =>
        schemaId.StartsWith("schema:", StringComparison.Ordinal) ? schemaId["schema:".Length..] : schemaId;

    private static bool IsHttpMethod(string value) => OpenApiSpecStore.HttpMethods.Contains(value);

    private static string? ReadString(JsonElement element, params string[] path)
    {
        var current = element;
        foreach (var segment in path)
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out current))
            {
                return null;
            }
        }

        return current.ValueKind == JsonValueKind.String ? current.GetString() : null;
    }

    private static bool ReadBool(JsonElement element, string propertyName)
    {
        return element.ValueKind == JsonValueKind.Object &&
               element.TryGetProperty(propertyName, out var property) &&
               property.ValueKind == JsonValueKind.True;
    }

    private static IReadOnlyList<string> ReadStringArray(JsonElement element, string propertyName)
    {
        if (element.ValueKind != JsonValueKind.Object ||
            !element.TryGetProperty(propertyName, out var array) ||
            array.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return array.EnumerateArray()
            .Where(item => item.ValueKind == JsonValueKind.String)
            .Select(item => item.GetString()!)
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .ToArray();
    }

    private static string? ReadType(JsonElement element)
    {
        if (TryDirectSchemaRef(element, out var schemaId))
        {
            return SchemaName(schemaId);
        }

        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        if (element.TryGetProperty("enum", out var enumElement) && enumElement.ValueKind == JsonValueKind.Array)
        {
            return "enum";
        }

        if (element.TryGetProperty("type", out var type) && type.ValueKind == JsonValueKind.String)
        {
            if (string.Equals(type.GetString(), "array", StringComparison.OrdinalIgnoreCase) &&
                element.TryGetProperty("items", out var items))
            {
                return TryDirectSchemaRef(items, out var itemRef) ? $"{SchemaName(itemRef)}[]" : "array";
            }

            return type.GetString();
        }

        if (element.TryGetProperty("oneOf", out var oneOf) && oneOf.ValueKind == JsonValueKind.Array)
        {
            return $"oneOf ({oneOf.GetArrayLength()})";
        }

        if (element.TryGetProperty("allOf", out var allOf) && allOf.ValueKind == JsonValueKind.Array)
        {
            return $"allOf ({allOf.GetArrayLength()})";
        }

        if (element.TryGetProperty("anyOf", out var anyOf) && anyOf.ValueKind == JsonValueKind.Array)
        {
            return $"anyOf ({anyOf.GetArrayLength()})";
        }

        return "object";
    }

    private static IReadOnlyList<string> ReadEnumValues(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object ||
            !element.TryGetProperty("enum", out var enumElement) ||
            enumElement.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return enumElement.EnumerateArray()
            .Take(20)
            .Select(item => item.ValueKind == JsonValueKind.String ? item.GetString() : item.GetRawText())
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Cast<string>()
            .ToArray();
    }
}
