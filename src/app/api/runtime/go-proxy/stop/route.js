import { NextResponse } from "next/server";
import { stopGoProxyRuntime } from "@/lib/goProxyRuntime";

export async function POST() {
  const runtime = await stopGoProxyRuntime();
  return NextResponse.json(runtime);
}
