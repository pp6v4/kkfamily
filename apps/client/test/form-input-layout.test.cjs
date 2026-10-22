const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { parse } = require('vue/compiler-sfc');

// PostCSS is already a Vite dependency. Resolve from that installed package,
// rather than adding a dependency or relying on a global installation.
const postcss = createRequire(require.resolve('vite'))('postcss');
const SRC = path.resolve(__dirname, '../src');
const FORMS = ['pages/recipe-editor/index.vue', 'pages/camping/index.vue', 'components/trip-itinerary.vue'];
const geometry = /^(?:height|min-height|max-height|box-sizing|font-size|padding(?:-(?:top|right|bottom|left))?|border(?:-(?:top|right|bottom|left))?(?:-width)?)$/;

function vueFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? vueFiles(filename) : entry.name.endsWith('.vue') ? [filename] : [];
  });
}

function readSfc(filename) {
  const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  assert.deepEqual(errors, [], `Cannot parse ${filename}`);
  return { filename, descriptor, css: descriptor.styles.map(style => style.content) };
}

const app = readSfc(path.join(SRC, 'App.vue'));
const pages = vueFiles(SRC).filter(filename => filename !== app.filename).map(readSfc);

function elements(ast) {
  const rows = [];
  function visit(node, parent) {
    if (node.type !== 1) { for (const child of node.children || []) visit(child, parent); return; }
    const classes = node.props.find(prop => prop.type === 6 && prop.name === 'class')?.value?.content || '';
    const entry = { node, parent, tag: node.tag, classes: new Set(classes.split(/\s+/).filter(Boolean)) };
    rows.push(entry);
    for (const child of node.children || []) visit(child, entry);
  }
  visit(ast, undefined);
  return rows;
}

function compoundMatches(selector, element) {
  // Fail closed on newly introduced selectors that this small layout checker
  // cannot model; do not silently assume that a complex rule is harmless.
  assert.match(selector, /^(?:[\w-]+|\*)?(?:\.[\w-]+)*$/, `Unsupported layout selector: ${selector}`);
  const tag = selector.match(/^[\w-]+/)?.[0];
  if (tag && tag !== element.tag) return false;
  return Array.from(selector.matchAll(/\.([\w-]+)/g), match => match[1]).every(name => element.classes.has(name));
}

function selectorMatches(selector, element) {
  // A button border reset on ::after styles its generated box, not the input
  // itself. Validate the originating selector, but never apply that geometry
  // to real elements; other unsupported selector syntax still fails closed.
  if (/::(?:before|after)$/.test(selector.trim())) {
    selectorMatches(selector.trim().replace(/::(?:before|after)$/, ''), element);
    return false;
  }
  const tokens = selector.trim().split(/\s*(>)\s*|\s+/).filter(Boolean);
  function match(index, entry) {
    if (!entry || !compoundMatches(tokens[index], entry)) return false;
    if (index === 0) return true;
    if (tokens[index - 1] === '>') return match(index - 2, entry.parent);
    for (let ancestor = entry.parent; ancestor; ancestor = ancestor.parent) if (match(index - 1, ancestor)) return true;
    return false;
  }
  return tokens.length > 0 && match(tokens.length - 1, element);
}

function rulesFor(sfc, css = sfc.css) {
  const rules = [];
  css.forEach((source, styleIndex) => {
    postcss.parse(source).walkRules(rule => {
      const declarations = rule.nodes.filter(node => node.type === 'decl' && geometry.test(node.prop));
      if (!declarations.length) return;
      for (const selector of rule.selectors) {
        const scoped = Boolean(sfc.descriptor.styles[styleIndex]?.scoped);
        const specificity = (selector.match(/\.[\w-]+/g) || []).length * 10
          + (selector.match(/(?:^|[\s>])(?:[a-z][\w-]*)/g) || []).length + (scoped ? 10 : 0);
        rules.push({ selector, specificity, declarations, conditional: rule.parent.type === 'atrule' });
      }
    });
  });
  return rules;
}

function expand(declaration) {
  const property = declaration.prop, value = declaration.value;
  const sides = ['top', 'right', 'bottom', 'left'];
  if (property === 'padding' || property === 'border-width') {
    const values = value.trim().split(/\s+/);
    assert.ok(values.length >= 1 && values.length <= 4, `Unsupported ${property}: ${value}`);
    const expanded = [values[0], values[1] || values[0], values[2] || values[0], values[3] || values[1] || values[0]];
    return sides.map((side, index) => [property === 'padding' ? `padding-${side}` : `border-${side}-width`, expanded[index]]);
  }
  if (/^border(?:-(?:top|right|bottom|left))?$/.test(property)) {
    const width = value === 'none' ? '0' : value.match(/^(\d+(?:\.\d+)?(?:rpx|px|em|rem)?)(?:\s|$)/)?.[1];
    assert.ok(width !== undefined, `Unsupported border width: ${value}`);
    return (property === 'border' ? sides : [property.slice(7)]).map(side => [`border-${side}-width`, width]);
  }
  return [[property, value]];
}

function cascade(element, rules) {
  const values = new Map();
  rules.forEach((rule, index) => {
    if (!selectorMatches(rule.selector, element)) return;
    assert.equal(rule.conditional, false, `Conditional geometry needs an explicit viewport test: ${rule.selector}`);
    rule.declarations.forEach((declaration, declarationIndex) => {
      const weight = [declaration.important ? 1 : 0, rule.specificity, index, declarationIndex];
      for (const [property, value] of expand(declaration)) {
        const previous = values.get(property);
        if (!previous || weight.some((part, position) => part > previous.weight[position] && weight.slice(0, position).every((earlier, i) => earlier === previous.weight[i]))) values.set(property, { value, weight });
      }
    });
  });
  return new Map(Array.from(values, ([key, entry]) => [key, entry.value]));
}

// Calculate in rpx at a 375 CSS-pixel viewport; font sizes in these sources are
// explicit rpx. An absent native input height is NOT assumed to be safe.
function length(value, em = 32) {
  assert.ok(value !== undefined, 'Missing explicit input height/min-height');
  const match = value.match(/^(\d+(?:\.\d+)?)(rpx|px|em|rem)?$/);
  assert.ok(match, `Unsupported layout length: ${value}`);
  return Number(match[1]) * ({ rpx: 1, px: 2, em, rem: 32 }[match[2]] || 1);
}

function audit(page, globalCss = app.css, localCss = page.css) {
  const all = elements(page.descriptor.template?.ast || { type: 0, children: [] });
  const inputs = all.filter(entry => entry.tag === 'input');
  const globalRules = rulesFor(app, globalCss), localRules = rulesFor(page, localCss), rules = [...globalRules, ...localRules];
  const strictForm = FORMS.includes(path.relative(SRC, page.filename).replaceAll('\\', '/'));
  for (const input of inputs) {
    const position = `${path.relative(SRC, page.filename)}:${input.node.loc.start.line}`;
    const css = cascade(input, rules);
    assert.equal(css.get('box-sizing'), 'border-box', `${position}: input box model must be explicit`);
    const height = length(css.get('height')), minimum = length(css.get('min-height'));
    assert.ok(height >= 88 && minimum >= 88, `${position}: input height/min-height regressed: ${height}/${minimum}`);
    let fontSize = 32;
    for (let ancestor = input; ancestor; ancestor = ancestor.parent) {
      const inherited = cascade(ancestor, rules).get('font-size');
      if (inherited !== undefined) { fontSize = length(inherited); break; }
    }
    const vertical = ['padding-top', 'padding-bottom', 'border-top-width', 'border-bottom-width'].reduce((sum, property) => sum + length(css.get(property) || '0', fontSize), 0);
    const content = Math.max(height, minimum) - vertical;
    assert.ok(content >= fontSize * 1.4, `${position}: content area ${content}rpx < 1.4em (${fontSize * 1.4}rpx), text may be clipped`);
    if (strictForm) {
      const local = cascade(input, localRules);
      assert.ok(length(local.get('height')) >= 88 && length(local.get('min-height')) >= 88, `${position}: repaired form must retain local height guards`);
      assert.ok(input.node.props.some(prop => prop.type === 6 && prop.name === 'placeholder' && prop.value?.content.trim()), `${position}: input needs a useful placeholder`);
    }
  }
  return inputs.length;
}

function mutateCss(css, mutation) {
  return css.map(source => { const root = postcss.parse(source); mutation(root); return root.toString(); });
}

function appendCss(css, source) {
  return css.map((original, index) => index === css.length - 1 ? `${original}\n${source}` : original);
}

test('All native inputs keep sufficient text content height after global and scoped CSS cascade', () => {
  const count = pages.reduce((sum, page) => sum + audit(page), 0);
  assert.ok(count >= 40, `Unexpected input inventory: ${count}`);
  for (const relative of FORMS) assert.ok(audit(pages.find(page => page.filename === path.join(SRC, relative))) > 0);
});

test('Removing the global native input height guards is rejected for legacy forms', () => {
  const globalCss = mutateCss(app.css, root => root.walkDecls(declaration => { if (['height', 'min-height'].includes(declaration.prop)) declaration.remove(); }));
  const legacy = pages.find(page => page.filename === path.join(SRC, 'pages/tasks/index.vue'));
  assert.throws(() => audit(legacy, globalCss), /Missing explicit input height/);
});

test('Removing local height guards or reintroducing excessive padding is rejected for each repaired form', () => {
  for (const relative of FORMS) {
    const page = pages.find(entry => entry.filename === path.join(SRC, relative));
    const withoutLocalHeight = mutateCss(page.css, root => root.walkDecls(declaration => { if (['height', 'min-height'].includes(declaration.prop)) declaration.remove(); }));
    assert.throws(() => audit(page, app.css, withoutLocalHeight), /Missing explicit input height/);
    const padded = appendCss(page.css, '.input { padding-top: 60rpx; padding-bottom: 60rpx; }');
    assert.throws(() => audit(page, app.css, padded), /content area .* text may be clipped/);
  }
});

test('Cascade uses scoped class specificity and declaration order rather than matching the first CSS string', () => {
  const page = pages.find(entry => entry.filename === path.join(SRC, FORMS[0]));
  const tooShort = appendCss(page.css, '.page .input { height: 12rpx; min-height: 12rpx; } input { height: 88rpx; min-height: 88rpx; }');
  assert.throws(() => audit(page, app.css, tooShort), /height\/min-height regressed: 12\/12/);
  const padded = appendCss(page.css, '.input { padding: 60rpx; padding-top: 0; padding-bottom: 0; }');
  assert.ok(audit(page, app.css, padded) > 0);
});

test('Generated pseudo-element geometry is not applied to native inputs; unsupported selectors remain rejected', () => {
  const page = pages.find(entry => entry.filename === path.join(SRC, FORMS[0]));
  const generated = appendCss(page.css, '.input::after { height: 1rpx; min-height: 1rpx; padding: 60rpx; border: 2rpx solid #fff; }');
  assert.ok(audit(page, app.css, generated) > 0);
  const real = appendCss(generated, '.input { height: 1rpx; min-height: 1rpx; }');
  assert.throws(() => audit(page, app.css, real), /height\/min-height regressed/);
  assert.throws(() => audit(page, app.css, appendCss(page.css, 'input:is(.input) { padding: 1rpx; }')), /Unsupported layout selector/);
});
