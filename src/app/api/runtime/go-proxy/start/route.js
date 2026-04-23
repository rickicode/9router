import { NextResponse } from "next/server";
import { getGoProxyRuntimeStatus, startGoProxyRuntime } from "@/lib/goProxyRuntime";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  try {
    const runtime = await startGoProxyRuntime(body);
    return NextResponse.json(runtime);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error.message.replace("[Go Proxy Runtime] Runtime manager verification failed: ", ""), runtime: getGoProxyRuntimeStatus() },
      { status: 500 },
    );
  }
}
