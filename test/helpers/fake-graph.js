/**
 * A fake Microsoft Graph for `callGraphAPIPaginated`, with the rules measured
 * on a personal mailbox, so ladder tests fail when a request breaks one:
 * - `$search` goes alone (400 SearchWithFilter / SearchWithOrderBy otherwise),
 *   returns newest first and stops after `searchCap` rows (275 live);
 * - `$orderby` needs `receivedDateTime` to lead the `$filter` (400 InefficientFilter);
 * - the recipient lambda is refused (400 ErrorInvalidUrlQueryFilter) unless `lambdaOk`;
 * - `$orderby=receivedDateTime asc|desc` sorts (refused for asc with `noAsc`);
 * - an unsorted filtered request comes back oldest first, or newest first with
 *   `unsortedNewest` (what the name-or-address `from` filter did live, #377);
 * - date windows are evaluated, and results page by `@odata.nextLink`.
 *
 * `opts.fail(n, params, endpoint)` may return an Error to throw for request `n`.
 */
function makeGraph(mailbox, opts = {}) {
  const calls = [];
  const bad = (code) =>
    new Error(`API call failed with status 400: {"error":{"code":"${code}"}}`);
  const t = (m) => Date.parse(m.receivedDateTime);
  function evalClause(c, m) {
    c = c.trim();
    let x;
    if ((x = c.match(/^receivedDateTime (ge|le) (\S+)$/))) {
      return x[1] === 'ge'
        ? t(m) >= Date.parse(x[2])
        : t(m) <= Date.parse(x[2]);
    }
    if ((x = c.match(/^contains\(subject, '(.*)'\)$/))) {
      return (m.subject || '').toLowerCase().includes(x[1].toLowerCase());
    }
    if ((x = c.match(/^from\/emailAddress\/address eq '(.*)'$/))) {
      return m.from.emailAddress.address.toLowerCase() === x[1].toLowerCase();
    }
    if ((x = c.match(/^contains\(from\/emailAddress\/address, '(.*)'\)$/))) {
      return m.from.emailAddress.address
        .toLowerCase()
        .includes(x[1].toLowerCase());
    }
    if (
      (x = c.match(
        /^\(contains\(from\/emailAddress\/name, '(.*)'\) or contains\(from\/emailAddress\/address, '(.*)'\)\)$/
      ))
    ) {
      return (
        m.from.emailAddress.name.toLowerCase().includes(x[1].toLowerCase()) ||
        m.from.emailAddress.address.toLowerCase().includes(x[1].toLowerCase())
      );
    }
    if (c === 'hasAttachments eq true') return m.hasAttachments === true;
    if (c === 'isRead eq false') return m.isRead === false;
    if ((x = c.match(/^toRecipients\/any\(r: (.*)\)$/))) {
      const v = (x[1].match(/'([^']*)'/) || [])[1].toLowerCase();
      return (m.toRecipients || []).some((r) =>
        `${r.emailAddress.address} ${r.emailAddress.name}`
          .toLowerCase()
          .includes(v)
      );
    }
    throw new Error(`fake-graph: unparsed clause ${c}`);
  }
  const pages = new Map();
  let linkN = 0;
  function page(rows, top, max) {
    // mimic callGraphAPIPaginated: gather pages of `top` until >= max
    const take = Math.max(top, Math.ceil(max / top) * top);
    const got = rows.slice(0, take);
    const rest = rows.slice(take);
    const out = {
      value: max > 0 ? got.slice(0, max) : got,
      hasMore: got.length > max || rest.length > 0,
    };
    if (rest.length > 0 && got.length <= max) {
      const link = `https://graph.microsoft.com/v1.0/next/${++linkN}`;
      pages.set(link, { rows: rest, top });
      out['@odata.nextLink'] = link;
    }
    if (!out.hasMore) out['@odata.count'] = out.value.length;
    return out;
  }
  const respond = (endpoint, params, max) => {
    const n = calls.length;
    calls.push({
      endpoint: endpoint.startsWith('http') ? 'NEXT' : endpoint,
      ...params,
    });
    if (opts.fail) {
      const e = opts.fail(n, params, endpoint);
      if (e) throw e;
    }
    if (endpoint.startsWith('http')) {
      const p = pages.get(endpoint);
      return page(p.rows, p.top, max);
    }
    const top = Number(params.$top) || 10;
    if (params.$search) {
      if (params.$filter) throw bad('SearchWithFilter');
      if (params.$orderby) throw bad('SearchWithOrderBy');
      const raw = params.$search.replace(/^"|"$/g, '');
      if (opts.search) return page(opts.search(raw, mailbox), top, max);
      if (!/^".*"$/.test(params.$search) && /[:<>=]/.test(raw)) {
        throw new Error(
          'API call failed with status 400: {"error":{"code":"BadRequest","message":"Syntax error: character \':\' is not valid"}}'
        );
      }
      const words = raw.toLowerCase().split(/\s+/);
      const rows = mailbox
        .filter((m) =>
          words.every((w) =>
            `${m.subject} ${m.body || m.bodyPreview || ''}`
              .toLowerCase()
              .includes(w)
          )
        )
        .sort((a, b) => t(b) - t(a))
        .slice(0, opts.searchCap || 275);
      return page(rows, top, max);
    }
    let rows = mailbox;
    if (params.$filter) {
      const clauses = params.$filter.split(' and ');
      if (!opts.lambdaOk && /toRecipients\/any/.test(params.$filter)) {
        throw bad('ErrorInvalidUrlQueryFilter');
      }
      if (
        params.$orderby &&
        (!/^receivedDateTime /.test(clauses[0]) ||
          opts.noSort ||
          (opts.noAsc && / asc$/.test(params.$orderby)))
      ) {
        throw bad('InefficientFilter');
      }
      rows = rows.filter((m) => clauses.every((c) => evalClause(c, m)));
    }
    const newestFirst = params.$orderby
      ? !/ asc$/.test(params.$orderby)
      : Boolean(opts.unsortedNewest); // unsorted = oldest first (live)
    rows = [...rows].sort((a, b) => (newestFirst ? t(b) - t(a) : t(a) - t(b)));
    return page(rows, top, max);
  };
  // Rejections, not synchronous throws, as the real client gives.
  const fn = (_tok, _m, endpoint, params = {}, max = 0) =>
    Promise.resolve().then(() => respond(endpoint, params, max));
  fn.calls = calls;
  return fn;
}
let seq = 0;
function msg(o = {}) {
  seq++;
  return {
    id: o.id || `m${seq}`,
    subject: o.subject || 'Hello',
    bodyPreview: o.body || 'body text',
    body: o.body,
    from: {
      emailAddress: {
        name: o.fromName || 'Alice',
        address: o.from || 'alice@example.com',
      },
    },
    toRecipients: [
      {
        emailAddress: {
          name: o.toName || 'Me',
          address: o.to || 'me@live.com',
        },
      },
    ],
    receivedDateTime: o.date || '2026-01-01T00:00:00Z',
    isRead: o.isRead ?? true,
    hasAttachments: o.att ?? false,
  };
}
const day = (n) => new Date(Date.UTC(2015, 0, 1) + n * 86400000).toISOString(); // n days after 2015-01-01
module.exports = { makeGraph, msg, day };
