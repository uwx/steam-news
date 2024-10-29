// -----------------------------------------------------------------------
// Copyright (c) 2008, Stone Steps Inc.
// All rights reserved
// http://www.stonesteps.ca/legal/bsd-license/
//
// This is a BBCode parser written in JavaScript. The parser is intended
// to demonstrate how to parse text containing BBCode tags in one pass
// using regular expressions.
//
// The parser may be used as a backend component in ASP or in the browser,
// after the text containing BBCode tags has been served to the client.
//
// Following BBCode expressions are recognized:
//
// [b]bold[/b]
// [i]italic[/i]
// [u]underlined[/u]
// [s]strike-through[/s]
// [samp]sample[/samp]
//
// [color=red]red[/color]
// [color=#FF0000]red[/color]
// [size=1.2]1.2em[/size]
//
// [url]http://blogs.stonesteps.ca/showpost.asp?pid=33[/url]
// [url=http://blogs.stonesteps.ca/showpost.asp?pid=33][b]BBCode[/b] Parser[/url]
// [url="http://blogs.stonesteps.ca/showpost.asp?pid=33"][b]BBCode[/b] Parser[/url]
//
// [q=http://blogs.stonesteps.ca/showpost.asp?pid=33]inline quote[/q]
// [q]inline quote[/q]
// [quote=http://blogs.stonesteps.ca/showpost.asp?pid=33]inline quote[/quote]
// [quote]inline quote[/quote]
// [blockquote=http://blogs.stonesteps.ca/showpost.asp?pid=33]block quote[/blockquote]
// [blockquote]block quote[/blockquote]
//
// [pre]formatted
//     text[/pre]
// [code]if(a == b)
//   print("done");[/code]
//
// text containing [noparse] [brackets][/noparse]
//
// -----------------------------------------------------------------------

//
// post must be HTML-encoded
//
export function parse(post: string, crlf2br_default = true, img_style: string = 'style="display: inline-block; max-width: 100%;"') {
    img_style = img_style ? ' ' + img_style : '';

    let opentags: taginfo_t[] = [];           // open tag stack
    let crlf2br = crlf2br_default;     // convert CRLF to <br>?
    let noparse = false;    // ignore BBCode tags?

    let urlstart = -1;      // beginning of the URL if zero or greater (ignored if -1)

    // aceptable BBcode tags, optionally prefixed with a slash
    const tagname_re = /^\/?(?:b|i|u|pre|center|samp|code|colou?r|size|noparse|url|link|s(trike)?|q|(block)?quote|img|[uo]?list|li|spoiler|previewyoutube|table|t[rhd]|h[123456])$/i;

    // color names or hex color
    const color_re = /^(:?black|silver|gray|white|maroon|red|purple|fuchsia|green|lime|olive|yellow|navy|blue|teal|aqua|#(?:[0-9a-f]{3})?[0-9a-f]{3})$/i;

    // numbers
    const number_re = /^[\\.0-9]{1,8}$/i;

    // reserved, unreserved, escaped and alpha-numeric [RFC2396]
    const uri_re = /^[-;\/\?:@&=\+\$,_\.!~\*'\(\)%0-9a-z]{1,512}$/i;

    // main regular expression: CRLF, [tag=option], [tag="option"] [tag] or [/tag]
    const postfmt_re = /([\r\n])|(?:\[([a-z]{1,16})(?:=(?:"|'|)([^\x00-\x1F"'\(\)<>\[\]]{1,256}))?(?:"|'|)\])|(?:\[\/([a-z]{1,16})\])/ig;

    // stack frame object
    class taginfo_t {
        constructor(public bbtag: string, public etag: string) {}
    }

    // check if it's a valid BBCode tag
    function isValidTag(str: string) {
        if (!str || !str.length)
            return false;

        return tagname_re.test(str);
    }

    //
    // m1 - CR or LF
    // m2 - the tag of the [tag=option] expression
    // m3 - the option of the [tag=option] expression
    // m4 - the end tag of the [/tag] expression
    //
    function textToHtmlCB(mstr: string, m1: string, m2: string, m3: string, m4: string, offset: number, string: string) {
        //
        // CR LF sequences
        //
        if (m1 && m1.length) {
            if (!crlf2br)
                return mstr;

            switch (m1) {
                case '\r':
                    return "";
                case '\n':
                    return "<br>";
            }
        }

        //
        // handle start tags
        //
        if (isValidTag(m2)) {
            var m2l = m2.toLowerCase();

            // if in the noparse state, just echo the tag
            if (noparse)
                return `[${m2}]`;

            // ignore any tags if there's an open option-less [url] tag
            if (opentags.length && (opentags[opentags.length - 1].bbtag == "url" || opentags[opentags.length - 1].bbtag == "link") && urlstart >= 0)
                return `[${m2}]`;

            switch (m2l) {
                case "code":
                    opentags.push(new taginfo_t(m2l, "</code></pre>"));
                    crlf2br = false;
                    return "<pre><code>";

                case "pre":
                    opentags.push(new taginfo_t(m2l, "</pre>"));
                    crlf2br = false;
                    return "<pre>";

                case "center":
                    opentags.push(new taginfo_t(m2l, "</center>"));
                    crlf2br = false;
                    return "<center>";

                case "color":
                case "colour":
                    if (!m3 || !color_re.test(m3))
                        m3 = "inherit";
                    opentags.push(new taginfo_t(m2l, "</span>"));
                    return `<span style="color: ${m3}">`;

                case "size":
                    if (!m3 || !number_re.test(m3))
                        m3 = "1";
                    opentags.push(new taginfo_t(m2l, "</span>"));
                    return `<span style="font-size: ${Math.min(Math.max(+m3, 0.7), 3)}em">`;

                case "s":
                case "strike":
                    opentags.push(new taginfo_t(m2l, "</span>"));
                    return `<span style="text-decoration: line-through">`;

                case "noparse":
                    noparse = true;
                    return "";

                case "link":
                case "url":
                    opentags.push(new taginfo_t(m2l, "</a>"));

                    // check if there's a valid option
                    if (m3 && uri_re.test(m3)) {
                        // if there is, output a complete start anchor tag
                        urlstart = -1;
                        return `<a target="_blank" href="${m3}">`;
                    }

                    // otherwise, remember the URL offset
                    urlstart = mstr.length + offset;

                    // and treat the text following [url] as a URL
                    return `<a target="_blank" href="`;

                case "img":
                    opentags.push(new taginfo_t(m2l, "\" />"));

                    if (m3 && uri_re.test(m3)) {
                        urlstart = -1;
                        return `<${m2l}${img_style} src="${m3}`;
                    }

                    return `<${m2l}${img_style} src="`;

                case "q":
                case "quote":
                case "blockquote": {
                    const tag = (m2l === "q") ? "q" : "blockquote";
                    opentags.push(new taginfo_t(m2l, `</${tag}>`));
                    return m3 && m3.length && uri_re.test(m3) ? `<${tag} cite="${m3}">` : `<${tag}>`;
                }

                case "table":
                case "tr":
                case "th":
                case "td":
                case "h1":
                case "h2":
                case "h3":
                case "h4":
                case "h5":
                case "h6": {
                    opentags.push(new taginfo_t(m2l, `</${m2l}>`));
                    return `<${m2l}>`;
                }

                case "olist":
                case "list":
                    opentags.push(new taginfo_t('list', '</ol>'));
                    return '<ol>';

                case "ulist":
                    opentags.push(new taginfo_t('ulist', '</ul>'));
                    return '<ul>';

                case "b":
                    opentags.push(new taginfo_t('b', '</strong>'));
                    return '<strong>';

                case "i":
                    opentags.push(new taginfo_t('i', '</em>'));
                    return '<em>';

                case "spoiler":
                    opentags.push(new taginfo_t('spoiler', '</span>'));
                    return '<span style="color: #000000;background-color: #000000;padding: 0px 8px;">';

                case "previewyoutube": // [previewyoutube=gJEgjiorUPo;full][/previewyoutube]
                    opentags.push(new taginfo_t('previewyoutube', ''));

                    if (m3) {
                        return `<a rel="nofollow" href="https://www.youtube.com/watch?v=${m3.slice(0, m3.indexOf(';'))}">https://www.youtube.com/watch?v=${m3.slice(0, m3.indexOf(';'))}</a>`;
                    }

                    return '';

                default:
                    // [samp] and [u] don't need special processing
                    opentags.push(new taginfo_t(m2l, "</" + m2l + ">"));
                    return `<${m2l}>`;

            }
        }

        //
        // process end tags
        //
        if (isValidTag(m4)) {
            var m4l = m4.toLowerCase();

            if (noparse) {
                // if it's the closing noparse tag, flip the noparse state
                if (m4 == "noparse") {
                    noparse = false;
                    return "";
                }

                // otherwise just output the original text
                return `[/${m4}]`;
            }

            // highlight mismatched end tags
            if (!opentags.length || opentags[opentags.length - 1].bbtag != m4l)
                return `<span style="color: red">[/${m4}]</span>`;

            if (m4l == "url" || m4l == "link") {
                // if there was no option, use the content of the [url] tag
                if (urlstart > 0)
                    return `">${string.slice(urlstart, offset)}${opentags.pop()!.etag}`;

                // otherwise just close the tag
                return opentags.pop()!.etag;
            } else if (m4l == "code" || m4l == "pre") {
                crlf2br = crlf2br_default;
            }

            // other tags require no special processing, just output the end tag
            var end = opentags.pop()!.etag;
            return end;
        }

        return mstr;
    }

    // actual parsing can begin
    var result = '', endtags, tag;

    // convert CRLF to <br> by default
    crlf2br = crlf2br_default;

    // create a new array for open tags
    if (opentags == null || opentags.length)
        opentags = new Array(0);

    // run the text through main regular expression matcher
    if (post) {
        // idea to replace single *'s from http://patorjk.com/bbcode-previewer/
        post = (_post => _post.replace(/(\[\*\])([^\[]*)/g, (m0, m1, m2, offset, mstr) => `[li]${m2}[/li]`))(post);

        result = post.replace(postfmt_re, textToHtmlCB);

        // reset noparse, if it was unbalanced
        if (noparse)
            noparse = false;

        // if there are any unbalanced tags, make sure to close them
        if (opentags.length) {
            endtags = new String();

            // if there's an open [url] at the top, close it
            if (opentags[opentags.length - 1].bbtag == "url" || opentags[opentags.length - 1].bbtag == "link") {
                opentags.pop();
                endtags += `">${post.slice(urlstart)}</a>`;
            }

            // close remaining open tags
            while (opentags.length)
                endtags += opentags.pop()!.etag;
        }
    }

    const ret = endtags ? result + endtags : result;
    return ret;
}