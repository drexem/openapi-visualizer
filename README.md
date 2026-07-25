# OpenAPI Visualizer

C# ASP.NET Core MVP for visualizing selected OpenAPI endpoint model graphs.

## Run

```powershell
dotnet run --urls http://localhost:5117
```

Open `http://localhost:5117/`, upload a JSON OpenAPI 3.x spec, search endpoints, and select a few endpoints to render a cycle-safe graph slice.

## MVP Scope

- Parses the whole JSON spec upfront on the backend.
- Indexes endpoints, component schemas, schema properties, schema references, and model cycles.
- Renders only selected endpoint graph slices.
- Shows model properties on node hover and click.
- Handles cyclic schema graphs without recursive expansion.

## Sample

`samples/tiny-openapi.json` contains a small model cycle for local testing.
