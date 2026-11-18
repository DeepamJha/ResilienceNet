import http from 'k6/http';
import { check } from 'k6';
export const options = { vus: 100, duration: '30s' };
export default function () {
  const response = http.post('http://localhost:3000/webhooks/load-test', JSON.stringify({ burst: Date.now() }), { headers: { 'content-type': 'application/json', 'idempotency-key': `${__VU}-${__ITER}`, 'x-webhook-signature': __ENV.WEBHOOK_SIGNATURE || '' } });
  check(response, { 'accepted or duplicate': (r) => r.status === 202 || r.status === 200 });
}
