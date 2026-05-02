<?php
/**
 * Lector minimo de archivos .xlsx sin dependencias externas.
 * Usa ZipArchive + SimpleXML (incluidos en PHP).
 */
class LectorExcel
{
    /**
     * Lee un xlsx y devuelve array con 'header' (primera fila) y 'rows' (resto).
     * Cada fila es array indexado por columna (0-based).
     */
    public static function leerFilas(string $path): array
    {
        if (!file_exists($path)) {
            throw new \RuntimeException('Archivo no encontrado: ' . $path);
        }

        $zip = new \ZipArchive();
        if ($zip->open($path) !== true) {
            throw new \RuntimeException('No se pudo abrir el archivo xlsx');
        }

        // Leer cadenas compartidas (shared strings)
        $strings = [];
        $ssXml = $zip->getFromName('xl/sharedStrings.xml');
        if ($ssXml) {
            $ss = new \SimpleXMLElement($ssXml);
            foreach ($ss->si as $si) {
                if (isset($si->t)) {
                    $strings[] = (string) $si->t;
                } else {
                    $text = '';
                    foreach ($si->r as $r) {
                        $text .= (string) $r->t;
                    }
                    $strings[] = $text;
                }
            }
        }

        // Leer la primera hoja
        $sheetXml = $zip->getFromName('xl/worksheets/sheet1.xml');
        if (!$sheetXml) {
            $zip->close();
            throw new \RuntimeException('No se encontro la hoja 1');
        }

        $sheet = new \SimpleXMLElement($sheetXml);
        $header = null;
        $rows = [];

        foreach ($sheet->sheetData->row as $row) {
            $rowData = [];
            foreach ($row->c as $cell) {
                $colRef = preg_replace('/[0-9]/', '', (string) $cell['r']);
                $colIdx = self::colToIndex($colRef);
                $type = (string) ($cell['t'] ?? '');
                $value = (string) ($cell->v ?? '');

                if ($type === 's' && isset($strings[(int) $value])) {
                    $value = $strings[(int) $value];
                } elseif ($type === '' && $value !== '' && strpos($value, '.') === false && strlen($value) >= 5) {
                    $numVal = (float) $value;
                    if ($numVal > 40000 && $numVal < 60000) {
                        $timestamp = ($numVal - 25569) * 86400;
                        $value = date('Y-m-d', (int) $timestamp);
                    }
                }

                $rowData[$colIdx] = $value;
            }

            if ($header === null) {
                $header = $rowData;
                continue;
            }

            if (!empty(array_filter($rowData, fn($v) => trim($v) !== ''))) {
                $rows[] = $rowData;
            }
        }

        $zip->close();
        return ['header' => $header ?? [], 'rows' => $rows];
    }

    private static function colToIndex(string $col): int
    {
        $col = strtoupper($col);
        $index = 0;
        for ($i = 0; $i < strlen($col); $i++) {
            $index = $index * 26 + (ord($col[$i]) - ord('A'));
        }
        return $index;
    }
}
