const doT = require('./doT/doT');
const fs = require('fs');

const t = doT.template(fs.readFileSync('./style.xsl.dot', 'utf-8'), {
    strip: false,
    encoders: { '': require('./doT/encodeHTML')(), 'str': e => JSON.stringify('' + e) }
});

fs.writeFileSync('./style.xsl', t({
    function: doT.template(fs.readFileSync('./template.dot', 'utf-8'), { selfContained: true, strip: false, encoders: { '': '(' + require('./doT/encodeHTML').toString() + ')()' } })
}));