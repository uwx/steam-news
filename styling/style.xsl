<?xml version="1.0" encoding="utf-8"?>
<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/"
                xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">

  <xsl:output method="xml" version="1.0" encoding="UTF-8" indent="no" />

  <xsl:template match="/">
    <html xmlns="http://www.w3.org/1999/xhtml" lang="en">
      <head>
        <title><xsl:value-of select="/rss/channel/title"/> Web Feed</title>
        <meta http-equiv="Content-Type" content="application/xhtml+xml; charset=utf-8" />

        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
        <link rel="stylesheet" href="styles.css"/>
      </head>
      <body class="bg-gray-dark text-white">
        <rss version="2.0" style="display: none" id="rss">
          <xsl:for-each select="rss/*">
          <xsl:copy-of select="."/>
          </xsl:for-each>

          <!--<xsl:copy-of select="rss"/>-->
        </rss>

        <script><![CDATA[
          const div = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
          div.innerHTML = (function(it){const _enc=(function getEncodeHtml() {
  const encodeHTMLRules = {
    "&": "&#38;",
    "<": "&#60;",
    ">": "&#62;",
    '"': "&#34;",
    "'": "&#39;",
    "/": "&#47;",
  }

  const matchHTML = /&(?!#?\w+;)|<|>|"|'|\//g

  return function encodeHtml(/** @type {string} */ s) {
    return typeof s === "string" ? s.replace(matchHTML, (m) => encodeHTMLRules[m] || m) : s
  }
})();let out='';      function safify(str) {          return str.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)}`);      }        var rss = document.getElementById('rss');      function query(selector) {          return rss.querySelector(selector).textContent.trim();      }  out+='\r\n<nav class="container-md px-3 py-2 mt-2 mt-md-5 mb-5 markdown-body">\r\n    <p class="bg-yellow-light ttext-gray-dark ml-n1 px-1 py-1 mb-1">\r\n    <strong>This is a web feed,</strong> also known as an RSS feed. <strong>Subscribe</strong> by copying the URL from the address bar into your newsreader.\r\n    </p>\r\n    <p class="text-gray-light">\r\n    Visit <a class="link-gray" href="https://aboutfeeds.com">About Feeds</a> to get started with newsreaders and subscribing. It’s free.\r\n    </p>\r\n</nav>\r\n<div class="container-md px-3 py-3 markdown-body">\r\n    <header class="py-5">\r\n        <h1 class="border-0">\r\n            <!-- https://commons.wikimedia.org/wiki/File:Feed-icon.svg -->\r\n            <svg xmlns="http://www.w3.org/2000/svg" version="1.1" style="vertical-align: text-bottom; width: 1.2em; height: 1.2em;" class="pr-1" id="RSSicon" viewBox="0 0 256 256">\r\n                <defs>\r\n                    <linearGradient x1="0.085" y1="0.085" x2="0.915" y2="0.915" id="RSSg">\r\n                        <stop  offset="0.0" stop-color="#E3702D"/><stop  offset="0.1071" stop-color="#EA7D31"/>\r\n                        <stop  offset="0.3503" stop-color="#F69537"/><stop  offset="0.5" stop-color="#FB9E3A"/>\r\n                        <stop  offset="0.7016" stop-color="#EA7C31"/><stop  offset="0.8866" stop-color="#DE642B"/>\r\n                        <stop  offset="1.0" stop-color="#D95B29"/>\r\n                    </linearGradient>\r\n                </defs>\r\n                <rect width="256" height="256" rx="55" ry="55" x="0"  y="0"  fill="#CC5D15"/>\r\n                <rect width="246" height="246" rx="50" ry="50" x="5"  y="5"  fill="#F49C52"/>\r\n                <rect width="236" height="236" rx="47" ry="47" x="10" y="10" fill="url(#RSSg)"/>\r\n                <circle cx="68" cy="189" r="24" fill="#FFF"/>\r\n                <path d="M160 213h-34a82 82 0 0 0 -82 -82v-34a116 116 0 0 1 116 116z" fill="#FFF"/>\r\n                <path d="M184 213A140 140 0 0 0 44 73 V 38a175 175 0 0 1 175 175z" fill="#FFF"/>\r\n            </svg>\r\n\r\n            Web Feed Preview\r\n        </h1>\r\n        <h2>'+_enc( query('channel > title') )+'</h2>\r\n        <p>'+_enc( query('channel > description') )+'</p>\r\n        <a class="link-gray head_link" target="_blank" href="'+_enc( query('channel > link') )+'">Visit Website &#x2192;</a>\r\n    </header>\r\n    <h2>Recent Items</h2>\r\n    '; for (const x of rss.querySelectorAll('channel > item')) { out+='\r\n        <div class="pb-5">\r\n            <h3 class="mb-0">\r\n                <a class="link-gray" target="_blank" href="'+_enc( x.querySelector('link').textContent.trim() )+'">\r\n                    '+_enc( x.querySelector('title').textContent )+'\r\n                </a>\r\n            </h3>\r\n            <small class="text-gray">\r\n                Published: '+_enc( x.querySelector('pubDate').textContent )+'\r\n            </small>\r\n        </div>\r\n    '; } out+='\r\n</div>';return out;})({});
          document.body.append(div);
        ]]></script>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>