import { NextResponse } from "next/server";
import { getGoProxyRuntimeStatus, restartGoProxyRuntime } from "@/lib/goProxyRuntime";

export async function POST(request) {
  let body = {};

  if (request) {
    try {
      body = await request.json();
    } catch {
      body = {};
    }
  }

  try {
    const runtime = await restartGoProxyRuntime(body);
    return NextResponse.json(runtime);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error.message.replace("[Go Proxy Runtime] Runtime manager verification failed: ", ""), runtime: getGoProxyRuntimeStatus() },
      { status: 500 },
    );
  }
}
