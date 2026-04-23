import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { v4 as uuidv4 } from "uuid";

const VALID_STATUSES = new Set(["unknown", "online", "offline", "error"]);

function normalizeUrl(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\/$/, "");
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function readCloudUrls() {
  const settings = await getSettings();
  return Array.isArray(settings.cloudUrls) ? settings.cloudUrls : [];
}

async function writeCloudUrls(mutator) {
  const currentSettings = await getSettings();
  const currentUrls = Array.isArray(currentSettings.cloudUrls) ? currentSettings.cloudUrls : [];
  const clonedUrls = currentUrls.map((entry) => structuredClone(entry));
  const nextUrls = mutator(clonedUrls);
  const settings = await updateSettings({ cloudUrls: nextUrls });
  return settings.cloudUrls;
}

function getNextId(cloudUrls) {
  return uuidv4();
}

export async function GET() {
  try {
    return NextResponse.json({ cloudUrls: await readCloudUrls() });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to load cloud URLs" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const url = normalizeUrl(body?.url);
    let lastChecked = body?.lastChecked ?? null;

    if (lastChecked) {
      const date = new Date(lastChecked);
      if (Number.isNaN(date.getTime()) || date > new Date()) {
        lastChecked = null;
      }
    }

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }
    if (!isValidHttpUrl(url)) {
      return NextResponse.json({ error: "URL must be a valid HTTP or HTTPS address" }, { status: 400 });
    }

    const updated = await writeCloudUrls((cloudUrls) => {
      if (cloudUrls.some((entry) => normalizeUrl(entry.url) === url)) {
        throw new Error("Cloud URL already exists");
      }

      const nextEntry = {
        id: getNextId(cloudUrls),
        url,
        status: VALID_STATUSES.has(body?.status) ? body.status : "unknown",
        lastChecked,
      };

      return [...cloudUrls, nextEntry];
    });

    return NextResponse.json({ cloudUrls: updated }, { status: 201 });
  } catch (error) {
    const status = error.message === "Cloud URL already exists" ? 409 : 500;
    return NextResponse.json({ error: error.message || "Failed to create cloud URL" }, { status });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    const { id, status } = body;
    let lastChecked = body?.lastChecked ?? null;

    if (lastChecked) {
      const date = new Date(lastChecked);
      if (Number.isNaN(date.getTime()) || date > new Date()) {
        lastChecked = null;
      }
    }

    if (!id) {
      return NextResponse.json({ error: "Valid cloud URL id is required" }, { status: 400 });
    }

    if (status && !VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: "Invalid status value" }, { status: 400 });
    }

    const updatedUrls = await writeCloudUrls((cloudUrls) => {
      const index = cloudUrls.findIndex((entry) => entry.id === id);
      if (index === -1) throw new Error("Cloud URL not found");

      if (status) cloudUrls[index].status = status;
      if (lastChecked) cloudUrls[index].lastChecked = lastChecked;

      return cloudUrls;
    });

    return NextResponse.json({ success: true, cloudUrls: updatedUrls });
  } catch (error) {
    const statusMap = {
      "Cloud URL not found": 404,
    };
    return NextResponse.json(
      { error: error.message || "Failed to update cloud URL" },
      { status: statusMap[error.message] || 500 }
    );
  }
}

export async function DELETE(request) {
  try {
    const body = await request.json();
    const id = String(body?.id ?? "").trim();

    if (!id) {
      return NextResponse.json({ error: "Valid cloud URL id is required" }, { status: 400 });
    }

    const updated = await writeCloudUrls((cloudUrls) => {
      const index = cloudUrls.findIndex((entry) => entry.id === id);
      if (index === -1) {
        throw new Error("Cloud URL not found");
      }
      if (cloudUrls.length === 1) {
        throw new Error("At least one cloud URL must remain");
      }

      return cloudUrls.filter((entry) => entry.id !== id);
    });

    return NextResponse.json({ cloudUrls: updated });
  } catch (error) {
    const statusMap = {
      "Valid cloud URL id is required": 400,
      "Cloud URL not found": 404,
      "At least one cloud URL must remain": 400,
    };
    return NextResponse.json({ error: error.message || "Failed to delete cloud URL" }, { status: statusMap[error.message] || 500 });
  }
}
