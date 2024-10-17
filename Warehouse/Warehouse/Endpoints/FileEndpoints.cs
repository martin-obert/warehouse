namespace Warehouse.Endpoints;

public static class FileEndpoints
{
    public static IResult Get()
    {
        var files =Directory.GetFiles(path: Environment.GetEnvironmentVariable("WAREHOUSE_ROOT"),
            "*", SearchOption.AllDirectories);
        return Results.Ok(files);
    }
}