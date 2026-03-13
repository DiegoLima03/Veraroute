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
}
