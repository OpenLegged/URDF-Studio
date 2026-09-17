#!/usr/bin/env node

/**
 * Exported-archive inspection for the workflow E2E suite: unzip the exported
 * archive (JSZip) and return structured facts the journeys assert on.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

/**
 * Unzip an exported archive and inspect the robot definition inside.
 * Returns { hasRobot, hasSdfModel, xml, linkCount, jointCount, files }.
 */
export async function inspectUrdfArchive(archivePath, { deletedLink = null, sdf = false } = {}) {
  const data = await fs.readFile(archivePath);
  const zip = await JSZip.loadAsync(data);
  const files = Object.keys(zip.files);

  // The export bundle puts the robot definition at the zip root; find the
  // first .urdf/.sdf/.xml entry (skip meshes).
  const candidates = files
    .filter((name) => /\.(urdf|sdf|xml)$/i.test(name))
    .filter((name) => !/mesh|urdf\.xacro/i.test(name))
    .sort((a, b) => a.length - b.length);
  if (candidates.length === 0) {
    // Some exports may be a bare file, not an archive.
    const asText = data.toString('utf8');
    if (asText.includes('<robot') || asText.includes('<sdf')) {
      return summarize(asText, files, deletedLink);
    }
    throw new Error(`No robot definition found in export ${archivePath}: ${JSON.stringify(files)}`);
  }

  const xml = await zip.files[candidates[0]].async('string');
  const summary = summarize(xml, files, deletedLink);
  summary.entry = candidates[0];
  return summary;
}

function summarize(xml, files, deletedLink) {
  const links = xml.match(/<link\s+name="/g)?.length ?? 0;
  const joints = xml.match(/<joint\s+name="/g)?.length ?? 0;
  return {
    xml,
    files,
    hasRobot: xml.includes('<robot'),
    hasSdfModel: xml.includes('<model') && xml.includes('<sdf'),
    linkCount: links,
    jointCount: joints,
    deletedLinkAbsent: deletedLink ? !xml.includes(`name="${deletedLink}"`) : null,
  };
}
