<?php

require_once __DIR__ . '/../core/Controller.php';

class PageController extends Controller
{
    public function index()
    {
        require __DIR__ . '/../views/app.php';
    }
}
