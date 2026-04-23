import { NextResponse } from "next/server";
import { getGoProxyRuntimeStatus } from "@/lib/goProxyRuntime";

export async function GET() {
  return NextResponse.json(getGoProxyRuntimeStatus());
}
