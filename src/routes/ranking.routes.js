const express = require('express');
const router = express.Router();
const { getWeeklyRanking, getAllTimeRanking } = require('../controllers/ranking.controller');

router.get('/weekly', getWeeklyRanking);
router.get('/all-time', getAllTimeRanking);

module.exports = router;
