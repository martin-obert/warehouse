using Asp.Versioning;
using Microsoft.Extensions.Options;
using Swashbuckle.AspNetCore.SwaggerGen;
using Warehouse.Endpoints;
using Warehouse.Swagger;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddApiVersioning(config =>
{
    config.DefaultApiVersion = new ApiVersion(1.0);
    config.ReportApiVersions = true;
    config.AssumeDefaultVersionWhenUnspecified = true;
    config.ApiVersionReader = new UrlSegmentApiVersionReader();
}).AddApiExplorer(config =>
{
    config.GroupNameFormat = "'v'VVV";
    config.SubstituteApiVersionInUrl = true;
});
builder.Services.AddTransient<IConfigureOptions<SwaggerGenOptions>, ConfigureSwaggerOptions>();
builder.Services.AddSwaggerGen(options => options.OperationFilter<SwaggerDefaultValues>());

var app = builder.Build();
var orders = app.NewVersionedApi("Orders");

// 2.0
var ordersV2 = orders.MapGroup("/api/v{v:apiVersion}")
    .HasApiVersion(2.0);

ordersV2.MapGet("/", FileEndpoints.Get).WithName("TEST").Produces<string[]>();

app.UseSwagger();
if ( app.Environment.IsDevelopment() )
{
    app.UseSwaggerUI(
        options =>
        {
            var descriptions = app.DescribeApiVersions();

            // build a swagger endpoint for each discovered API version
            foreach ( var description in descriptions )
            {
                var url = $"/swagger/{description.GroupName}/swagger.json";
                var name = description.GroupName.ToUpperInvariant();
                options.SwaggerEndpoint( url, name );
            }
        } );
}
app.Run();