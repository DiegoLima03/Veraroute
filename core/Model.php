<?php

class Model
{
    protected function db()
    {
        return Database::connect();
    }

    protected function query(string $sql, array $params = [])
    {
        $stmt = $this->db()->prepare($sql);
        $stmt->execute($params);
        return $stmt;
    }

    protected function normalizeTextValue($value)
    {
        if (!is_string($value) || $value === '') {
            return $value;
        }

        $normalized = $value;

        // Algunos textos importados llegaron con UTF-8 interpretado como CP850.
        if (preg_match('/[├┬┼▒®¢⌐±]/u', $normalized)) {
            $candidate = @iconv('UTF-8', 'CP850//IGNORE', $normalized);
            if (is_string($candidate) && $candidate !== '' && preg_match('//u', $candidate)) {
                $normalized = $candidate;
            }
        }

        // Otros textos vienen con el mojibake clasico tipo "CoruÃ±a".
        if (strpbrk($normalized, 'ÃÂ') !== false) {
            $candidate = @mb_convert_encoding($normalized, 'ISO-8859-1', 'UTF-8');
            if (is_string($candidate) && $candidate !== '' && preg_match('//u', $candidate)) {
                $normalized = $candidate;
            }
        }

        return str_replace(
            ['Corña', 'corña'],
            ['Coruña', 'coruña'],
            $normalized
        );
    }

    protected function normalizeTextRow(array $row): array
    {
        foreach ($row as $key => $value) {
            $row[$key] = $this->normalizeTextValue($value);
        }
        return $row;
    }

    protected function normalizeTextRows(array $rows): array
    {
        return array_map(fn($row) => is_array($row) ? $this->normalizeTextRow($row) : $row, $rows);
    }
}
