const crypto = require('crypto');
const axios = require('axios');
const https = require('https');

const PROXY = { host: '127.0.0.1', port: 6789 };
const AGENT = new https.Agent({ rejectUnauthorized: false });

function getClient() {
  return axios.create({
    proxy: PROXY, httpsAgent: AGENT, timeout: 20000, maxRedirects: 5,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept-Language': 'zh-CN,zh;q=0.9' },
    validateStatus: s => true,
  });
}

function sha512(str) {
  return crypto.createHash('sha512').update(str, 'utf8').digest('hex');
}

function solvePoW(challenge, difficulty = 4) {
  const target = '0'.repeat(difficulty);
  let nonce = 0;
  while (true) {
    if (sha512(challenge + nonce).startsWith(target)) return nonce;
    nonce++;
    if (nonce > 50000000) return -1;
  }
}

function extractPoster(html) {
  if (!html || typeof html !== 'string') return null;
  const og = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) ||
             html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
  if (og) return og[1];
  const main = html.match(/id="mainpic"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/i);
  if (main) return main[1];
  const img = html.match(/https?:\/\/img[0-9]?\.doubanio\.com\/(?:view|img)\/.+?\.(?:jpg|png)/i);
  if (img) return img[0];
  return null;
}

async function scrapePoster(doubanId) {
  const client = getClient();
  const url = `https://movie.douban.com/subject/${doubanId}/`;

  try {
    const resp1 = await client.get(url);
    const html = typeof resp1.data === 'string' ? resp1.data : '';
    const finalUrl = resp1.request?.res?.responseUrl || '';

    if (html.includes('og:image') || html.includes('mainpic')) {
      const poster = extractPoster(html);
      if (poster) return poster;
    }

    if (!html.includes('id="cha"')) {
      const poster = extractPoster(html);
      return poster || null;
    }

    // Extract PoW fields
    const cha = html.match(/id="cha"[^>]*value="([^"]+)"/);
    const tok = html.match(/id="tok"[^>]*value="([^"]+)"/);
    const red = html.match(/id="red"[^>]*value="([^"]+)"/);
    if (!cha || !tok) return null;

    let difficulty = 4;
    const diffMatch = html.match(/difficulty\s*=\s*(\d+)/);
    if (diffMatch) difficulty = parseInt(diffMatch[1]);

    const solution = solvePoW(cha[1], difficulty);
    if (solution < 0) return null;

    let cookies = (resp1.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

    // Submit PoW to the SAME URL that served the PoW page (including query params)
    const powUrl = finalUrl.includes('sec.douban.com') ? finalUrl : 'https://sec.douban.com/c';
    
    const formData = `tok=${encodeURIComponent(tok[1])}&cha=${encodeURIComponent(cha[1])}&sol=${solution}${red ? `&red=${encodeURIComponent(red[1])}` : ''}`;

    const resp2 = await client.post(powUrl, formData, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': finalUrl || url, 'Cookie': cookies },
      maxRedirects: 10,
    });

    // Merge cookies from PoW response
    if (resp2.headers['set-cookie']) {
      cookies += '; ' + resp2.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
    }

    // The PoW response should redirect us. Follow the chain.
    const h2 = typeof resp2.data === 'string' ? resp2.data : '';
    const finalUrl2 = resp2.request?.res?.responseUrl || '';

    // Try poster from PoW response
    let poster = extractPoster(h2);
    if (poster) return poster;

    // If redirected to a non-sec URL, try to get poster from it
    if (finalUrl2 && !finalUrl2.includes('sec.douban.com') && !h2.includes('id="cha"')) {
      poster = extractPoster(h2);
      if (poster) return poster;
    }

    // Directly try to fetch the movie page with accumulated cookies
    const movieUrl = red?.[1] || url;
    const resp3 = await client.get(movieUrl, {
      headers: { 'Cookie': cookies },
      maxRedirects: 10,
    });
    const h3 = typeof resp3.data === 'string' ? resp3.data : '';
    poster = extractPoster(h3);
    if (poster) return poster;

    // If still PoW page, the cookie didn't work - try again with more redirects
    if (h3.includes('id="cha"') && h3.includes('id="sec"')) {
      // The cookie-based bypass failed. Try a different approach -
      // follow any redirects from the PoW submit response
      if (resp2.status === 302 || resp2.status === 301 || resp2.status === 303) {
        const loc = resp2.headers['location'];
        if (loc) {
          const redirectUrl = loc.startsWith('http') ? loc : 'https://movie.douban.com' + loc;
          const resp4 = await client.get(redirectUrl, {
            headers: { 'Cookie': cookies },
            maxRedirects: 10,
          });
          const h4 = typeof resp4.data === 'string' ? resp4.data : '';
          poster = extractPoster(h4);
          if (poster) return poster;
        }
      }
    }

    return null;
  } catch (e) {
    console.log(`Douban error for ${doubanId}: ${(e.message || '').slice(0, 80)}`);
    return null;
  }
}

module.exports = { scrapePoster };
