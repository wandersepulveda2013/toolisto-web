(function () {
    'use strict';

    var docx = window.docx;

    var DEFAULTS = {
        FONT_FAMILY: 'Times New Roman',
        FONT_SIZE: 24,
        TITLE_FONT_SIZE: 28,
        LINE_SPACING: 480,
        MARGIN: 1440,
        INDENT: 720,
        HANGING_INDENT: 720
    };

    function getDefaults() {
        return {
            fontFamily: DEFAULTS.FONT_FAMILY,
            fontSize: DEFAULTS.FONT_SIZE,
            titleFontSize: DEFAULTS.TITLE_FONT_SIZE,
            lineSpacing: DEFAULTS.LINE_SPACING,
            margin: DEFAULTS.MARGIN,
            indent: DEFAULTS.INDENT,
            hangingIndent: DEFAULTS.HANGING_INDENT
        };
    }

    function validateInput(input) {
        var errors = [];

        if (!input || typeof input !== 'object') {
            return { valid: false, errors: ['Input must be an object'] };
        }

        if (!input.title || typeof input.title !== 'string' || input.title.trim() === '') {
            errors.push('Title is required');
        }

        if (!input.authors || !Array.isArray(input.authors) || input.authors.length === 0) {
            errors.push('At least one author is required');
        } else {
            for (var i = 0; i < input.authors.length; i++) {
                var author = input.authors[i];
                if (!author || typeof author !== 'object') {
                    errors.push('Author at index ' + i + ' must be an object');
                } else if (!author.name || typeof author.name !== 'string' || author.name.trim() === '') {
                    errors.push('Author at index ' + i + ' must have a name');
                }
            }
        }

        if (input.sections && Array.isArray(input.sections)) {
            for (var j = 0; j < input.sections.length; j++) {
                var section = input.sections[j];
                if (!section || typeof section !== 'object') {
                    errors.push('Section at index ' + j + ' must be an object');
                } else {
                    if (!section.heading || typeof section.heading !== 'string') {
                        errors.push('Section at index ' + j + ' must have a heading');
                    }
                    if (typeof section.level !== 'number' || [1, 2, 3].indexOf(section.level) === -1) {
                        errors.push('Section at index ' + j + ' must have a level of 1, 2, or 3');
                    }
                    if (!section.content || typeof section.content !== 'string') {
                        errors.push('Section at index ' + j + ' must have content');
                    }
                }
            }
        }

        if (input.references && Array.isArray(input.references)) {
            for (var k = 0; k < input.references.length; k++) {
                var ref = input.references[k];
                if (!ref || typeof ref !== 'object') {
                    errors.push('Reference at index ' + k + ' must be an object');
                } else if (!ref.text || typeof ref.text !== 'string' || ref.text.trim() === '') {
                    errors.push('Reference at index ' + k + ' must have text');
                }
            }
        }

        if (input.keywords && !Array.isArray(input.keywords)) {
            errors.push('Keywords must be an array');
        }

        if (input.appendices && Array.isArray(input.appendices)) {
            for (var m = 0; m < input.appendices.length; m++) {
                var appendix = input.appendices[m];
                if (!appendix || typeof appendix !== 'object') {
                    errors.push('Appendix at index ' + m + ' must be an object');
                } else {
                    if (!appendix.title || typeof appendix.title !== 'string') {
                        errors.push('Appendix at index ' + m + ' must have a title');
                    }
                    if (!appendix.content || typeof appendix.content !== 'string') {
                        errors.push('Appendix at index ' + m + ' must have content');
                    }
                }
            }
        }

        return errors.length === 0 ? { valid: true } : { valid: false, errors: errors };
    }

    function makePageNumberParagraph(style) {
        return new docx.Paragraph({
            alignment: docx.AlignmentType.RIGHT,
            spacing: { after: 0, line: 0 },
            children: [
                new docx.TextRun({
                    children: [
                        docx.PageNumber.CURRENT
                    ],
                    font: DEFAULTS.FONT_FAMILY,
                    size: DEFAULTS.FONT_SIZE
                })
            ]
        });
    }

    function makePageHeader() {
        return new docx.Header({
            children: [
                new docx.Paragraph({
                    alignment: docx.AlignmentType.RIGHT,
                    children: [
                        new docx.TextRun({
                            children: [
                                docx.PageNumber.CURRENT
                            ],
                            font: DEFAULTS.FONT_FAMILY,
                            size: DEFAULTS.FONT_SIZE
                        })
                    ]
                })
            ]
        });
    }

    function makeBlankLines(count, spacing) {
        var lines = [];
        for (var i = 0; i < count; i++) {
            lines.push(new docx.Paragraph({
                spacing: { after: spacing || 0, line: DEFAULTS.LINE_SPACING },
                children: []
            }));
        }
        return lines;
    }

    function makeCenteredText(text, opts) {
        var options = opts || {};
        return new docx.Paragraph({
            alignment: docx.AlignmentType.CENTER,
            spacing: { after: options.after || 0, line: options.lineSpacing || DEFAULTS.LINE_SPACING },
            children: [
                new docx.TextRun({
                    text: text,
                    bold: options.bold || false,
                    italics: options.italics || false,
                    font: options.fontFamily || DEFAULTS.FONT_FAMILY,
                    size: options.fontSize || DEFAULTS.FONT_SIZE,
                    underline: options.underline ? { type: docx.UnderlineType.SINGLE } : undefined
                })
            ]
        });
    }

    function makeLeftText(text, opts) {
        var options = opts || {};
        return new docx.Paragraph({
            alignment: docx.AlignmentType.LEFT,
            spacing: { after: options.after || 0, line: options.lineSpacing || DEFAULTS.LINE_SPACING },
            indent: options.indent ? { firstLine: options.indent } : undefined,
            children: [
                new docx.TextRun({
                    text: text,
                    bold: options.bold || false,
                    italics: options.italics || false,
                    font: options.fontFamily || DEFAULTS.FONT_FAMILY,
                    size: options.fontSize || DEFAULTS.FONT_SIZE
                })
            ]
        });
    }

    function makeBodyParagraph(text, indent) {
        return new docx.Paragraph({
            alignment: docx.AlignmentType.LEFT,
            spacing: { after: 0, line: DEFAULTS.LINE_SPACING },
            indent: { firstLine: indent || DEFAULTS.INDENT },
            children: [
                new docx.TextRun({
                    text: text,
                    font: DEFAULTS.FONT_FAMILY,
                    size: DEFAULTS.FONT_SIZE
                })
            ]
        });
    }

    function makeHeading1(text) {
        return new docx.Paragraph({
            alignment: docx.AlignmentType.CENTER,
            spacing: { before: DEFAULTS.LINE_SPACING, after: 0, line: DEFAULTS.LINE_SPACING },
            children: [
                new docx.TextRun({
                    text: text,
                    bold: true,
                    font: DEFAULTS.FONT_FAMILY,
                    size: DEFAULTS.FONT_SIZE
                })
            ]
        });
    }

    function makeHeading2(text) {
        return new docx.Paragraph({
            alignment: docx.AlignmentType.LEFT,
            spacing: { before: DEFAULTS.LINE_SPACING, after: 0, line: DEFAULTS.LINE_SPACING },
            children: [
                new docx.TextRun({
                    text: text,
                    bold: true,
                    italics: true,
                    font: DEFAULTS.FONT_FAMILY,
                    size: DEFAULTS.FONT_SIZE
                })
            ]
        });
    }

    function makeHeading3(text) {
        return new docx.Paragraph({
            alignment: docx.AlignmentType.LEFT,
            spacing: { before: DEFAULTS.LINE_SPACING, after: 0, line: DEFAULTS.LINE_SPACING },
            indent: { firstLine: DEFAULTS.INDENT },
            children: [
                new docx.TextRun({
                    text: toTitleCase(text),
                    bold: true,
                    font: DEFAULTS.FONT_FAMILY,
                    size: DEFAULTS.FONT_SIZE
                })
            ]
        });
    }

    function toTitleCase(str) {
        var smallWords = ['a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'to', 'from', 'by', 'in', 'of', 'with'];
        var words = str.split(' ');
        var result = [];
        for (var i = 0; i < words.length; i++) {
            var word = words[i].toLowerCase();
            if (i === 0 || i === words.length - 1 || smallWords.indexOf(word) === -1) {
                result.push(word.charAt(0).toUpperCase() + word.slice(1));
            } else {
                result.push(word);
            }
        }
        return result.join(' ');
    }

    function makeReferencesList(references, hanging) {
        var paragraphs = [];
        paragraphs.push(makeCenteredText('References', { bold: true, after: DEFAULTS.LINE_SPACING }));

        for (var i = 0; i < references.length; i++) {
            paragraphs.push(new docx.Paragraph({
                alignment: docx.AlignmentType.LEFT,
                spacing: { after: DEFAULTS.LINE_SPACING, line: DEFAULTS.LINE_SPACING },
                indent: { left: DEFAULTS.HANGING_INDENT, hanging: DEFAULTS.HANGING_INDENT },
                children: [
                    new docx.TextRun({
                        text: references[i].text,
                        font: DEFAULTS.FONT_FAMILY,
                        size: DEFAULTS.FONT_SIZE
                    })
                ]
            }));
        }

        return paragraphs;
    }

    function makeAppendixSection(appendix, index) {
        var paragraphs = [];
        var label = 'Appendix ' + String.fromCharCode(65 + index);
        paragraphs.push(makeCenteredText(label, { bold: true, after: 0 }));
        paragraphs.push(makeCenteredText(appendix.title, { bold: true, after: DEFAULTS.LINE_SPACING }));

        var lines = appendix.content.split('\n');
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].trim() !== '') {
                paragraphs.push(makeBodyParagraph(lines[i].trim()));
            }
        }

        return paragraphs;
    }

    function buildTitlePage(input) {
        var paragraphs = [];

        paragraphs = paragraphs.concat(makeBlankLines(3, 0));

        paragraphs.push(makeCenteredText(input.title, { bold: true, fontSize: DEFAULTS.TITLE_FONT_SIZE }));

        if (input.subtitle) {
            paragraphs.push(makeCenteredText(input.subtitle, { italics: true }));
        }

        paragraphs = paragraphs.concat(makeBlankLines(1, 0));

        if (input.authors && input.authors.length > 0) {
            for (var a = 0; a < input.authors.length; a++) {
                paragraphs.push(makeCenteredText(input.authors[a].name));
            }
        }

        if (input.institutions && input.institutions.length > 0) {
            for (var inst = 0; inst < input.institutions.length; inst++) {
                paragraphs.push(makeCenteredText(input.institutions[inst]));
            }
        } else if (input.authors && input.authors.length > 0 && input.authors[0].affiliation) {
            paragraphs.push(makeCenteredText(input.authors[0].affiliation));
        }

        if (input.course) {
            paragraphs.push(makeCenteredText(input.course));
        }

        if (input.instructor) {
            paragraphs.push(makeCenteredText(input.instructor));
        }

        var dateStr = input.date || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        paragraphs.push(makeCenteredText(dateStr));

        return paragraphs;
    }

    function buildAbstractPage(input) {
        var paragraphs = [];

        paragraphs.push(makeCenteredText('Abstract', { bold: true }));

        if (input.abstract) {
            paragraphs.push(new docx.Paragraph({
                alignment: docx.AlignmentType.LEFT,
                spacing: { after: 0, line: DEFAULTS.LINE_SPACING },
                indent: { firstLine: DEFAULTS.INDENT },
                children: [
                    new docx.TextRun({
                        text: input.abstract,
                        font: DEFAULTS.FONT_FAMILY,
                        size: DEFAULTS.FONT_SIZE
                    })
                ]
            }));
        }

        if (input.keywords && input.keywords.length > 0) {
            var keywordChildren = [
                new docx.TextRun({
                    text: 'Keywords: ',
                    italics: true,
                    font: DEFAULTS.FONT_FAMILY,
                    size: DEFAULTS.FONT_SIZE
                }),
                new docx.TextRun({
                    text: input.keywords.join(', '),
                    font: DEFAULTS.FONT_FAMILY,
                    size: DEFAULTS.FONT_SIZE
                })
            ];
            paragraphs.push(new docx.Paragraph({
                alignment: docx.AlignmentType.LEFT,
                spacing: { after: 0, line: DEFAULTS.LINE_SPACING },
                indent: { firstLine: DEFAULTS.INDENT },
                children: keywordChildren
            }));
        }

        return paragraphs;
    }

    function buildBody(sections) {
        var paragraphs = [];

        for (var i = 0; i < sections.length; i++) {
            var section = sections[i];

            switch (section.level) {
                case 1:
                    paragraphs.push(makeHeading1(section.heading));
                    break;
                case 2:
                    paragraphs.push(makeHeading2(section.heading));
                    break;
                case 3:
                    paragraphs.push(makeHeading3(section.heading));
                    break;
            }

            if (section.content) {
                var contentLines = section.content.split('\n');
                for (var c = 0; c < contentLines.length; c++) {
                    var line = contentLines[c].trim();
                    if (line !== '') {
                        paragraphs.push(makeBodyParagraph(line));
                    }
                }
            }
        }

        return paragraphs;
    }

    function buildAppendices(appendices) {
        var paragraphs = [];

        paragraphs.push(makeCenteredText('Appendices', { bold: true, after: DEFAULTS.LINE_SPACING }));

        for (var i = 0; i < appendices.length; i++) {
            paragraphs = paragraphs.concat(makeAppendixSection(appendices[i], i));
        }

        return paragraphs;
    }

    function format(input) {
        var validation = validateInput(input);
        if (!validation.valid) {
            return Promise.reject(new Error('Invalid input: ' + validation.errors.join('; ')));
        }

        var allParagraphs = [];

        allParagraphs = allParagraphs.concat(buildTitlePage(input));

        if (input.abstract || (input.keywords && input.keywords.length > 0)) {
            allParagraphs.push(new docx.Paragraph({
                children: [],
                pageBreakBefore: true
            }));
            allParagraphs = allParagraphs.concat(buildAbstractPage(input));
        }

        if (input.sections && input.sections.length > 0) {
            allParagraphs.push(new docx.Paragraph({
                children: [],
                pageBreakBefore: true
            }));
            allParagraphs = allParagraphs.concat(buildBody(input.sections));
        }

        if (input.references && input.references.length > 0) {
            allParagraphs.push(new docx.Paragraph({
                children: [],
                pageBreakBefore: true
            }));
            allParagraphs = allParagraphs.concat(makeReferencesList(input.references));
        }

        if (input.appendices && input.appendices.length > 0) {
            allParagraphs.push(new docx.Paragraph({
                children: [],
                pageBreakBefore: true
            }));
            allParagraphs = allParagraphs.concat(buildAppendices(input.appendices));
        }

        var header = makePageHeader();

        var doc = new docx.Document({
            sections: [
                {
                    properties: {
                        page: {
                            margin: {
                                top: DEFAULTS.MARGIN,
                                right: DEFAULTS.MARGIN,
                                bottom: DEFAULTS.MARGIN,
                                left: DEFAULTS.MARGIN
                            }
                        }
                    },
                    headers: {
                        default: header
                    },
                    children: allParagraphs
                }
            ]
        });

        return docx.Packer.toBlob(doc);
    }

    function formatReference(ref) {
        if (!ref || typeof ref !== 'object') {
            return '';
        }

        var parts = [];
        var authorStr = '';

        if (ref.authors && Array.isArray(ref.authors) && ref.authors.length > 0) {
            var authorParts = [];
            for (var i = 0; i < ref.authors.length; i++) {
                var author = ref.authors[i];
                if (author.last) {
                    var authorName = author.last + ', ';
                    if (author.first) {
                        var initials = author.first.charAt(0) + '.';
                        if (author.middle) {
                            initials = author.first.charAt(0) + '. ' + author.middle.charAt(0) + '.';
                        }
                        authorName += initials;
                    }
                    authorParts.push(authorName);
                }
            }

            if (authorParts.length === 1) {
                authorStr = authorParts[0];
            } else if (authorParts.length === 2) {
                authorStr = authorParts[0] + ', & ' + authorParts[1];
            } else if (authorParts.length <= 20) {
                authorStr = authorParts.slice(0, -1).join(', ') + ', & ' + authorParts[authorParts.length - 1];
            } else {
                authorStr = authorParts.slice(0, 19).join(', ') + ', ... ' + authorParts[authorParts.length - 1];
            }
        }

        if (authorStr) {
            parts.push(authorStr);
        }

        if (ref.year) {
            parts.push('(' + ref.year + ')');
        }

        if (ref.title) {
            parts.push(ref.title + '.');
        }

        if (ref.source) {
            var sourcePart = ref.source;
            if (ref.volume) {
                sourcePart += ', ' + ref.volume;
            }
            if (ref.issue) {
                sourcePart += '(' + ref.issue + ')';
            }
            if (ref.pages) {
                sourcePart += ', ' + ref.pages;
            }
            sourcePart += '.';
            parts.push(sourcePart);
        }

        if (ref.doi) {
            var doiUrl = ref.doi;
            if (doiUrl.indexOf('http') !== 0) {
                doiUrl = 'https://doi.org/' + doiUrl;
            }
            parts.push(doiUrl);
        }

        return parts.join(' ');
    }

    window.APA7Formatter = {
        format: format,
        formatReference: formatReference,
        validateInput: validateInput
    };
})();