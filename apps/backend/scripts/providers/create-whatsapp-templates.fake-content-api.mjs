// An in-memory stand-in for the Twilio Content API, used by `create-whatsapp-templates.mjs --self-test` and by
// `apps/backend/test/create-whatsapp-templates.spec.ts`. Nothing here touches the network: it is a `fetch`
// implementation over a Map.
//
// It is deliberately strict. Every rule below is Twilio's or Meta's published contract, so a request the real API
// would reject fails here instead — that, and nothing more, is what the self-test proves. Two deliberate
// differences from the real thing, both in the safe direction:
//
//   - friendly_name uniqueness. Twilio does NOT enforce it; a second run that failed to recognise its own
//     templates would quietly create 112 duplicates there. Here it is an error, so the mistake is loud.
//   - sids are sequential (`HX000…001`) rather than random, so a test can assert that a re-run kept them.
//
// What it cannot prove: that Twilio accepts this payload, that Meta approves the copy, or that the approval
// endpoint is spelled the way the OpenAPI spec spells it. Only a real account answers those.

const KNOWN_CONTENT_TYPES = ['twilio/text', 'twilio/quick-reply'];
const APPROVAL_CATEGORIES = ['UTILITY', 'MARKETING', 'AUTHENTICATION'];
const MAX_BODY_LENGTH = 1024;
const MAX_BUTTONS = 3;
const MAX_BUTTON_TITLE_LENGTH = 25;

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function twilioError(status, code, message) {
  return jsonResponse(status, { code, message, status });
}

function placeholderNumbers(text) {
  return [...text.matchAll(/\{\{(\d+)\}\}/g)].map((match) => match[1]);
}

/**
 * What the API stores is not byte-for-byte what it was sent: Twilio echoes resources back with fields of its own.
 * Modelling that here keeps the script honest about comparing only the fields it sets — a template that came back
 * with one extra key must not read as drift and be rewritten.
 */
function storedTypes(types) {
  const [contentType, content] = Object.entries(types)[0];
  if (contentType === 'twilio/quick-reply') {
    return {
      [contentType]: { ...content, actions: content.actions.map((action) => ({ ...action, type: 'QUICK_REPLY' })) },
    };
  }
  return { [contentType]: { ...content } };
}

/**
 * @param {object} [options]
 * @param {'whatsapp'|'WhatsApp'} [options.approvalPathSegment] which spelling of the approval path answers 2xx
 * @param {number} [options.pageSize] contents per list page, so pagination is exercised
 * @param {string} [options.accountSid]
 * @param {string} [options.authToken]
 */
export function createFakeContentApi({
  approvalPathSegment = 'whatsapp',
  pageSize = 50,
  accountSid = 'AC123',
  authToken = 'twilio-auth-token',
} = {}) {
  /** @type {Map<string, object>} sid -> content resource */
  const contents = new Map();
  const requests = [];
  const failures = [];
  let sidCounter = 0;

  const expectedAuthorization = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;

  function nextSid() {
    sidCounter += 1;
    return `HX${sidCounter.toString(16).padStart(32, '0')}`;
  }

  function byName(name) {
    return [...contents.values()].find((content) => content.friendly_name === name);
  }

  function validateContentBody(body) {
    if (!body || typeof body !== 'object') {
      return twilioError(400, 20001, 'a JSON body is required');
    }
    if (typeof body.friendly_name !== 'string' || !/^[a-z0-9_]{1,512}$/.test(body.friendly_name)) {
      return twilioError(400, 20001, 'friendly_name must be lowercase alphanumeric characters and underscores');
    }
    if (typeof body.language !== 'string' || !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(body.language)) {
      return twilioError(400, 20001, `unsupported language "${body.language}"`);
    }
    if (!body.types || typeof body.types !== 'object' || Object.keys(body.types).length !== 1) {
      return twilioError(400, 20001, 'types must carry exactly one content type');
    }

    const [contentType, content] = Object.entries(body.types)[0];
    if (!KNOWN_CONTENT_TYPES.includes(contentType)) {
      return twilioError(400, 20001, `unknown content type ${contentType}`);
    }
    if (typeof content?.body !== 'string' || content.body.trim().length === 0) {
      return twilioError(400, 20001, 'the content body is required');
    }
    if (content.body.length > MAX_BODY_LENGTH) {
      return twilioError(400, 20001, `the content body is longer than ${MAX_BODY_LENGTH} characters`);
    }
    if (/\{\{\s*[A-Za-z]/.test(content.body)) {
      return twilioError(400, 20001, 'WhatsApp templates take positional parameters ({{1}}), not named ones');
    }
    if (/\r|\n/.test(content.body)) {
      return twilioError(400, 20001, 'the content body must not contain newlines');
    }

    if (contentType === 'twilio/quick-reply') {
      const actions = content.actions;
      if (!Array.isArray(actions) || actions.length === 0 || actions.length > MAX_BUTTONS) {
        return twilioError(400, 20001, `a quick-reply template needs between 1 and ${MAX_BUTTONS} actions`);
      }
      const ids = new Set();
      for (const action of actions) {
        if (typeof action?.id !== 'string' || action.id.length === 0) {
          return twilioError(400, 20001, 'every action needs an id');
        }
        if (typeof action?.title !== 'string' || action.title.length === 0) {
          return twilioError(400, 20001, 'every action needs a title');
        }
        if (action.title.length > MAX_BUTTON_TITLE_LENGTH) {
          return twilioError(400, 20001, `action titles are limited to ${MAX_BUTTON_TITLE_LENGTH} characters`);
        }
        if (ids.has(action.id)) {
          return twilioError(400, 20001, `duplicate action id ${action.id}`);
        }
        ids.add(action.id);
      }
    }

    const variables = body.variables ?? {};
    if (typeof variables !== 'object' || Array.isArray(variables)) {
      return twilioError(400, 20001, 'variables must be an object keyed by parameter number');
    }
    const declared = Object.keys(variables);
    const used = [...new Set(placeholderNumbers(content.body))];
    if (declared.join(',') !== used.join(',')) {
      return twilioError(
        400,
        20001,
        `variables ${JSON.stringify(declared)} do not match the placeholders ${JSON.stringify(used)} in the body`,
      );
    }
    for (const [index, value] of Object.entries(variables)) {
      if (!/^[1-9]\d*$/.test(index)) {
        return twilioError(400, 20001, `variable key "${index}" is not a parameter number`);
      }
      if (typeof value !== 'string' || value.trim().length === 0) {
        return twilioError(400, 20001, `variable ${index} needs a sample value for Meta to review`);
      }
    }
    return undefined;
  }

  async function fetchImpl(url, init = {}) {
    const method = (init.method ?? 'GET').toUpperCase();
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    let body;
    if (typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        return twilioError(400, 20001, 'the request body is not valid JSON');
      }
    }
    requests.push({ method, path: parsed.pathname, search: parsed.search, body });

    const forcedIndex = failures.findIndex(
      (failure) =>
        (failure.method === undefined || failure.method === method) &&
        (failure.pathIncludes === undefined || parsed.pathname.includes(failure.pathIncludes)),
    );
    if (forcedIndex >= 0) {
      const [forced] = failures.splice(forcedIndex, 1);
      return twilioError(forced.status, forced.code ?? 20500, forced.message ?? 'forced failure');
    }

    const headers = init.headers ?? {};
    if (headers.Authorization !== expectedAuthorization) {
      return twilioError(401, 20003, 'Authentication Error - invalid username');
    }

    // GET /v1/ContentAndApprovals
    if (method === 'GET' && segments[1] === 'ContentAndApprovals') {
      const all = [...contents.values()];
      const token = Number(parsed.searchParams.get('PageToken') ?? '0');
      const page = all.slice(token, token + pageSize);
      const next = token + pageSize < all.length ? token + pageSize : undefined;
      return jsonResponse(200, {
        contents: page,
        meta: {
          page_size: pageSize,
          next_page_url:
            next === undefined ? null : `${parsed.origin}${parsed.pathname}?PageSize=${pageSize}&PageToken=${next}`,
        },
      });
    }

    // POST /v1/Content
    if (method === 'POST' && segments[1] === 'Content' && segments.length === 2) {
      const invalid = validateContentBody(body);
      if (invalid) {
        return invalid;
      }
      if (byName(body.friendly_name)) {
        return twilioError(409, 20409, `a template named ${body.friendly_name} already exists (fake-only rule)`);
      }
      const sid = nextSid();
      const content = {
        sid,
        account_sid: accountSid,
        friendly_name: body.friendly_name,
        language: body.language,
        variables: body.variables ?? {},
        types: storedTypes(body.types),
        approval_requests: null,
        date_created: '2026-01-01T00:00:00Z',
        date_updated: '2026-01-01T00:00:00Z',
        url: `https://content.twilio.com/v1/Content/${sid}`,
        links: { approval_create: `https://content.twilio.com/v1/Content/${sid}/ApprovalRequests/whatsapp` },
      };
      contents.set(sid, content);
      return jsonResponse(201, content);
    }

    // PUT /v1/Content/{sid}
    if (method === 'PUT' && segments[1] === 'Content' && segments.length === 3) {
      const content = contents.get(segments[2]);
      if (!content) {
        return twilioError(404, 20404, 'The requested resource was not found');
      }
      const invalid = validateContentBody(body);
      if (invalid) {
        return invalid;
      }
      if (content.approval_requests && content.approval_requests.status !== 'unsubmitted') {
        return twilioError(400, 20001, 'a template submitted for WhatsApp approval cannot be edited');
      }
      Object.assign(content, {
        friendly_name: body.friendly_name,
        language: body.language,
        variables: body.variables ?? {},
        types: storedTypes(body.types),
        date_updated: '2026-01-02T00:00:00Z',
      });
      return jsonResponse(200, content);
    }

    // POST /v1/Content/{sid}/ApprovalRequests/{channel}
    if (method === 'POST' && segments[1] === 'Content' && segments[3] === 'ApprovalRequests') {
      if (segments[4] !== approvalPathSegment) {
        return twilioError(404, 20404, 'The requested resource was not found');
      }
      const content = contents.get(segments[2]);
      if (!content) {
        return twilioError(404, 20404, 'The requested resource was not found');
      }
      if (typeof body?.name !== 'string' || !/^[a-z0-9_]{1,512}$/.test(body.name)) {
        return twilioError(400, 20001, 'name must be lowercase alphanumeric characters and underscores');
      }
      if (!APPROVAL_CATEGORIES.includes(body?.category)) {
        return twilioError(400, 20001, `category must be one of ${APPROVAL_CATEGORIES.join(', ')}`);
      }
      const clash = [...contents.values()].find(
        (other) => other.sid !== content.sid && other.approval_requests?.name === body.name,
      );
      if (clash) {
        return twilioError(400, 20001, `another template was already submitted as ${body.name}`);
      }
      content.approval_requests = {
        name: body.name,
        category: body.category,
        content_type: Object.keys(content.types)[0],
        status: 'received',
        rejection_reason: '',
      };
      return jsonResponse(201, { ...content.approval_requests, sid: content.sid });
    }

    return twilioError(404, 20404, 'The requested resource was not found');
  }

  return {
    fetchImpl,
    contents,
    requests,
    byName,
    /**
     * Forces one error response for the next request matching `method` and `pathIncludes` (both optional), to
     * exercise the failure path.
     */
    failNext(failure) {
      failures.push(failure);
    },
    /** Rewrites a stored template so the next run sees drift. */
    setBody(name, text) {
      const content = byName(name);
      const [type] = Object.keys(content.types);
      content.types[type].body = text;
    },
    setApproval(name, approval) {
      byName(name).approval_requests = approval;
    },
  };
}
