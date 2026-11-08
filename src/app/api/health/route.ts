import { createRequestContext } from "@/server/http/request-context";

export async function GET(request: Request) {
  const context = createRequestContext(request, "/api/health");

  const response = Response.json(
    { status: "ok" },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "X-Request-ID": context.requestId,
      },
    },
  );

  context.complete(response.status);

  return response;
}
