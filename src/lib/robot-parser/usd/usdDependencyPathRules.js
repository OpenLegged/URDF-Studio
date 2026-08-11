const dependencyStemByRootUsdFile = Object.freeze({
  "g1_29dof_rev_1_0.usd": "g1_29dof_rev_1_0",
  "g1_23dof_rev_1_0.usd": "g1_23dof_rev_1_0",
  "go2.usd": "go2_description",
  "go2w.usd": "go2w_description",
  "h1.usd": "h1",
  "h1_2.usd": "h1_2",
  "h1_2_handless.usd": "h1_2_handless",
  "b2.usd": "b2_description",
  "b2w.usd": "b2w_description",
});

export function inferUsdDependencyStemForPath(stagePath, fileName) {
  const normalizedPath = String(stagePath || "").toLowerCase();
  const normalizedFileName = String(fileName || "").trim().toLowerCase();
  const mappedStem = dependencyStemByRootUsdFile[normalizedFileName];
  if (mappedStem) {
    return mappedStem;
  }

  const inferredStem = normalizedFileName.replace(/\.usd[a-z]?$/i, "");
  if (!inferredStem) {
    return "";
  }
  if (!normalizedPath.includes("/configuration/")) {
    return inferredStem;
  }

  return inferredStem.replace(/_(base|physics|robot|sensor)$/i, "");
}
