// Offline inventory only. DisplayInfo is optional metadata, not the moc's
// authoritative parameter list; the renderer still validates the actual mouth.
export function cubism4Inventory(manifest, model, documents) {
  const refs = model.FileReferences;
  const parameters = documents.get(refs.DisplayInfo)?.Parameters;
  const metadataIds = parameters && new Set(parameters.map(parameter => parameter.Id));
  const warnings = [];
  const expressionEffects = (refs.Expressions || []).map(definition => {
    const expression = documents.get(definition.File);
    const entries = expression?.Parameters || [];
    const effective = entries.filter(parameter =>
      parameter.Blend === "Overwrite" ||
      (parameter.Blend === "Multiply" ? parameter.Value !== 1 : parameter.Value !== 0));
    return { name: definition.Name, parameterCount: entries.length,
      effectiveParameterCount: effective.length, identityOnly: effective.length === 0,
      parameters: effective.map(parameter => ({ id: parameter.Id, value: parameter.Value,
        blend: parameter.Blend || "Add" })) };
  });
  const expressionMappings = Object.entries(manifest.expressions || {}).map(([key, name]) => {
    const effect = expressionEffects.find(item => item.name === name);
    if (name !== null && !effect) throw new Error(`Unavailable expression mapping: ${key}`);
    if (effect?.identityOnly) warnings.push({ code: "identity_expression", key });
    return { key, name, resetsExtraExpression: name === null,
      identityOnly: effect?.identityOnly ?? null };
  });
  const motionMappings = Object.entries(manifest.motions || {}).map(([key, value]) => {
    const spec = typeof value === "string" ? { group: value } : value;
    const definitions = refs.Motions?.[spec.group];
    const choices = spec.index === undefined ? definitions : definitions?.slice(spec.index, spec.index + 1);
    if (!choices?.length) throw new Error(`Unavailable motion mapping: ${key}`);
    return { key, group: spec.group, index: spec.index ?? null,
      selection: spec.index === undefined ? "random_from_group" : "fixed_index",
      choices: choices.map(definition => {
        const motion = documents.get(definition.File);
        const parameterIds = (motion.Curves || [])
          .filter(curve => curve.Target === "Parameter").map(curve => curve.Id);
        const loop = spec.loop ?? motion.Meta.Loop;
        if (typeof spec.loop === "boolean" && spec.loop !== motion.Meta.Loop)
          warnings.push({ code: "motion_loop_override", key });
        return { file: definition.File, durationSeconds: motion.Meta.Duration,
          sourceFps: motion.Meta.Fps, sourceLoop: motion.Meta.Loop, effectiveLoop: loop,
          parameterIds, hasMouthCurve: parameterIds.includes(manifest.parameters.mouth),
          hasEyeCurves: [manifest.parameters.eyeLeft, manifest.parameters.eyeRight]
            .filter(Boolean).some(id => parameterIds.includes(id)) };
      }) };
  });
  const parameterMappings = Object.entries(manifest.parameters || {}).map(([key, id]) => {
    const declaredInDisplayInfo = metadataIds ? metadataIds.has(id) : null;
    if (declaredInDisplayInfo === false)
      warnings.push({ code: "parameter_absent_from_optional_display_info", key });
    return { key, id, declaredInDisplayInfo };
  });
  const groups = Object.fromEntries((model.Groups || []).map(group => [group.Name, group.Ids || []]));
  if (!groups.LipSync?.length) warnings.push({ code: "empty_lipsync_group_use_manifest_mouth" });
  if (!model.HitAreas?.length) warnings.push({ code: "no_model_hit_areas_runtime_uses_avatar_region" });
  return { expressionEffects, expressionMappings, motionMappings, parameterMappings,
    parameterMetadataAuthoritative: false,
    eyeBlinkIds: groups.EyeBlink || [], lipSyncIds: groups.LipSync || [],
    hitAreaCount: model.HitAreas?.length || 0,
    neutralSemantics: "remove_extra_expression_keep_motion_parameters",
    warnings };
}
