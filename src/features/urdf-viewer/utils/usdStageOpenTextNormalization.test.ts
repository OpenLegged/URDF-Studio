import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeUsdInstanceableVisualScopeVisibility } from '@/lib/robot-parser/usd/usdStageOpenTextNormalization';

test('normalizes top-level invisible visuals scopes that are referenced through instanceable visuals', () => {
  const source = `#usda 1.0
def Xform "Robot"
{
    def Xform "base_link"
    {
        def Xform "visuals" (
            instanceable = true
            prepend references = </visuals/base_link>
        )
        {
        }
    }
}

def Scope "visuals"
{
    token visibility = "invisible"

    def Xform "base_link"
    {
        def Xform "mesh_0"
        {
            uniform token purpose = "guide"
        }
    }
}
`;

  const normalized = normalizeUsdInstanceableVisualScopeVisibility(source);

  assert.match(normalized, /token visibility = "inherited"/);
  assert.match(normalized, /uniform token purpose = "render"/);
  assert.doesNotMatch(normalized, /token visibility = "invisible"/);
  assert.doesNotMatch(normalized, /token purpose = "guide"/);
});

test('keeps unrelated invisible visuals scopes unchanged when there is no instanceable visual reference', () => {
  const source = `#usda 1.0
def Xform "Robot"
{
}

def Scope "visuals"
{
    token visibility = "invisible"
}
`;

  const normalized = normalizeUsdInstanceableVisualScopeVisibility(source);

  assert.equal(normalized, source);
});

test('does not rewrite guide-purpose collision scopes when normalizing visuals', () => {
  const source = `#usda 1.0
def Xform "Robot"
{
    def Xform "base_link"
    {
        def Xform "visuals" (
            instanceable = true
            prepend references = </visuals/base_link>
        )
        {
        }
    }
}

def Scope "visuals"
{
    token visibility = "invisible"

    def Xform "base_link"
    {
        def Xform "mesh_0"
        {
            uniform token purpose = "guide"
        }
    }
}

def Scope "colliders"
{
    token visibility = "invisible"

    def Xform "base_link"
    {
        def Xform "mesh_0"
        {
            uniform token purpose = "guide"
        }
    }
}
`;

  const normalized = normalizeUsdInstanceableVisualScopeVisibility(source);

  assert.match(normalized, /def Scope "visuals"[\s\S]*uniform token purpose = "render"/);
  assert.match(normalized, /def Scope "colliders"[\s\S]*uniform token purpose = "guide"/);
});
