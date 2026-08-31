/* Review-only in-memory model. Not a production API or permission boundary. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PackingDesign = factory();
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  function createModel() {
    let serial = 0;
    const id = () => `review-${++serial}`;
    const state = { templates: [], items: [], readOnly: false };
    const groups = [{ id: 'g1', name: '我们家（示例）' }, { id: 'g2', name: '朋友家（示例）' }];
    const members = [{ id: 'm1', name: '成员甲（示例）', groupId: 'g1' }, { id: 'm2', name: '成员乙（示例）', groupId: 'g1' }, { id: 'm3', name: '朋友丙（示例）', groupId: 'g2' }];
    const copy = value => JSON.parse(JSON.stringify(value));
    function writable() { if (state.readOnly) throw new Error('当前为只读演示，不能修改清单'); }
    function name(value, label) {
      const text = String(value ?? '').trim();
      if (!text || text.length > 80) throw new Error(`${label}需填写1～80个字符`);
      return text;
    }
    function fields(row) {
      const quantity = String(row.quantity ?? '').trim();
      if (quantity && (!/^\d+(\.\d{1,3})?$/.test(quantity) || Number(quantity) <= 0 || Number(quantity) > 1000000)) throw new Error('数量请填写大于0、不超过1000000且最多3位小数的数值，或留空');
      const unit = String(row.unit ?? '').trim(), note = String(row.note ?? '').trim();
      if (unit.length > 20 || note.length > 200) throw new Error('单位最多20字，备注最多200字');
      return { name: name(row.name, '物品名称'), quantity, unit, note };
    }
    function template(key) {
      const result = state.templates.find(t => t.id === key);
      if (!result || result.archived) throw new Error('模板不存在或已归档');
      return result;
    }
    function item(key) {
      const result = state.items.find(t => t.id === key);
      if (!result) throw new Error('行李项不存在');
      return result;
    }
    function preview(keys) {
      let added = 0, skipped = 0;
      const details = [...new Set(keys)].map(key => {
        const t = template(key);
        const existing = t.items.filter(row => state.items.some(i => i.sourceItemId === row.id)).length;
        added += t.items.length - existing; skipped += existing;
        return { id: t.id, name: t.name, added: t.items.length - existing, skipped: existing };
      });
      return { added, skipped, details };
    }
    return {
      snapshot: () => copy({ ...state, groups, members }),
      setReadOnly(value) { state.readOnly = Boolean(value); },
      saveTemplate(key, title, rows) {
        writable();
        const cleanName = name(title, '模板名称');
        if (!Array.isArray(rows) || !rows.length) throw new Error('请至少添加一件物品');
        const old = key ? template(key) : null;
        const seen = new Set();
        const clean = rows.map(row => {
          const data = fields(row);
          if (row.id && (!old?.items.some(i => i.id === row.id) || seen.has(row.id))) throw new Error('模板物品标识无效或重复');
          if (row.id) seen.add(row.id);
          return { ...data, id: row.id || id() };
        });
        if (old) Object.assign(old, { name: cleanName, items: clean });
        else state.templates.push({ id: id(), name: cleanName, items: clean, archived: false });
        return copy(old || state.templates[state.templates.length - 1]);
      },
      archiveTemplate(key) { writable(); template(key).archived = true; },
      preview,
      apply(keys) {
        writable();
        const result = preview(keys); // Validate every selection before changing the list.
        for (const key of [...new Set(keys)]) {
          const t = template(key);
          for (const row of t.items) {
            if (state.items.some(i => i.sourceItemId === row.id)) continue;
            state.items.push({ ...copy(row), id: id(), sourceItemId: row.id, sourceName: t.name, sourceItemName: row.name, groupId: '', memberId: '', packed: false, excluded: false });
          }
        }
        return result;
      },
      addItem(row) {
        writable();
        const result = { ...fields(row), id: id(), sourceItemId: null, sourceName: '', sourceItemName: '', groupId: '', memberId: '', packed: false, excluded: false };
        state.items.push(result); return copy(result);
      },
      editItem(key, row) { writable(); Object.assign(item(key), fields(row)); },
      assign(key, groupId, memberId) {
        writable();
        if (groupId && !groups.some(g => g.id === groupId)) throw new Error('小组不属于本行程');
        const person = members.find(m => m.id === memberId);
        if (memberId && (!person || (groupId && person.groupId !== groupId))) throw new Error('负责人必须属于本行程及所选小组');
        Object.assign(item(key), { groupId, memberId });
      },
      setPacked(key, value) { writable(); const row = item(key); if (row.excluded) throw new Error('请先重新加入该物品'); row.packed = Boolean(value); },
      exclude(key) { writable(); item(key).excluded = true; },
      restore(key) { writable(); Object.assign(item(key), { excluded: false, packed: false }); },
    };
  }
  return { createModel };
});
