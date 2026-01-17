const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const ExcelJS = require('exceljs');
const path = require('path');

const app = express();
const PORT = 3001;
const EXCEL_PATH = path.join(__dirname, 'RP.xlsx');

app.use(cors());
app.use(bodyParser.json());

const colorToHex = (color) => {
    if (!color) return null;
    if (color.argb) {
        return '#' + (color.argb.length === 8 ? color.argb.substring(2) : color.argb);
    }
    if (color.theme !== undefined) {
        const themeColors = ['#FFFFFF', '#000000', '#ED7D31', '#4472C4', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47', '#44546A', '#262626'];
        return themeColors[color.theme] || '#cccccc';
    }
    return null;
};

const safeExtract = (cell) => {
    if (!cell) return '';
    const val = cell.value;
    if (val === null || val === undefined) return '';
    if (typeof val === 'object' && val !== null) {
        if (val.hasOwnProperty('result')) return val.result !== null ? val.result : '';
        if (val.hasOwnProperty('text')) return val.text !== null ? val.text : '';
        if (Array.isArray(val.richText)) return val.richText.map(t => t.text).join('');
        return '';
    }
    return val;
};

// Serve static files from the React app
app.use(express.static(path.join(__dirname, 'dist')));

app.get('/api/data', async (req, res) => {
    try {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(EXCEL_PATH);
        const sheet = workbook.getWorksheet(1);

        const papers = [];
        const researcher = {
            name: safeExtract(sheet.getRow(1).getCell(2)) || "Dr. DHIBIN VIKASH K P",
            credentials: safeExtract(sheet.getRow(1).getCell(3)) || "B.S., MBBS.",
            guide: safeExtract(sheet.getRow(2).getCell(2)) || "Dr. SATISH MUTHU",
            guideCredentials: safeExtract(sheet.getRow(2).getCell(3))
        };

        sheet.eachRow((row, rowNumber) => {
            if (rowNumber >= 4) {
                const idCell = row.getCell(1);
                const titleCell = row.getCell(2);
                const statusCell = row.getCell(3);

                const idVal = safeExtract(idCell);
                if (idVal !== '') {
                    const c1Color = colorToHex(idCell?.fill?.fgColor);
                    const c2Color = colorToHex(titleCell?.fill?.fgColor);
                    const c3Color = colorToHex(statusCell?.fill?.fgColor);

                    const isHighlighted = c1Color === '#00B050' && c2Color === '#00B050' && c3Color === '#00B050';

                    papers.push({
                        id: idVal,
                        title: safeExtract(titleCell),
                        status: safeExtract(statusCell) || "Yet to start",
                        color: c3Color,
                        fontColor: colorToHex(statusCell?.font?.color),
                        highlight: isHighlighted
                    });
                }
            }
        });

        res.json({ researcher, papers });
    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ error: error.message, stack: error.stack });
    }
});

app.post('/api/update', async (req, res) => {
    try {
        const { papers } = req.body;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(EXCEL_PATH);
        const sheet = workbook.getWorksheet(1);

        papers.forEach((paper, index) => {
            const row = sheet.getRow(4 + index);
            row.getCell(1).value = paper.id;
            row.getCell(2).value = paper.title;
            row.getCell(3).value = paper.status;
        });

        const finalRowCount = Math.max(sheet.rowCount, 4 + papers.length);
        for (let i = 4 + papers.length; i <= finalRowCount; i++) {
            const row = sheet.getRow(i);
            row.eachCell((cell) => { cell.value = null; });
        }

        await workbook.xlsx.writeFile(EXCEL_PATH);
        res.json({ success: true });
    } catch (error) {
        console.error("Update Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get('/:path*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
});
