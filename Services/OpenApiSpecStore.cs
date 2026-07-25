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

    public async Task<SpecSummary> ImportAsync(Stream stream, string fileName, CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer, cancellationToken);
        var bytes = buffer.ToArray();
        var specId = Convert.ToHexString(SHA256.HashData(bytes))[..16].ToLowerInvariant();

        if (_specs.TryGetValue(specId, out var existing))
        {
            CurrentSpecId = specId;
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
        CurrentSpecId = specId;
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

    public SchemaInfo? GetSchema(string specId, string schemaIdOrName)
    {
        return _specs.TryGetValue(specId, out var index)
            ? index.GetSchema(schemaIdOrName)
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
        var selectedEndpointIds = request.EndpointIds
            .Where(Endpoints.ContainsKey)
            .Distinct(StringComparer.Ordinal)
            .Take(25)
            .ToArray();

        if (selectedEndpointIds.Length == 0)
        {
            return new GraphResponse
            {
                Nodes = [],
                Edges = [],
                Cycles = [],
                Warnings = ["Select at least one endpoint to visualize."]
            };
        }

        var depth = request.AllReachable ? int.MaxValue : Math.Clamp(request.Depth, 0, 8);
        var maxNodes = Math.Clamp(request.MaxNodes, 25, 1_000);
        var nodes = new Dictionary<string, GraphNode>(StringComparer.Ordinal);
        var edges = new Dictionary<string, GraphEdge>(StringComparer.Ordinal);
        var schemaDepth = new Dictionary<string, int>(StringComparer.Ordinal);
        var queue = new Queue<(string SchemaId, int Depth)>();

        foreach (var endpointId in selectedEndpointIds)
        {
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

        static bool IsErrorResponseUse(EndpointSchemaUse schemaUse)
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
