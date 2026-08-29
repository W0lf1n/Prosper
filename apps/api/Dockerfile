# Build
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/Prosper.Api/Prosper.Api.csproj src/Prosper.Api/
RUN dotnet restore src/Prosper.Api/Prosper.Api.csproj
COPY src/ src/
RUN dotnet publish src/Prosper.Api/Prosper.Api.csproj -c Release -o /app

# Run
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .

# Not root. The API writes nothing to disk — Postgres holds everything.
USER $APP_UID

ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "Prosper.Api.dll"]
