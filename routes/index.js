require('dotenv').config();
const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const axios = require('axios'); // Make sure to import axios



// Videos GET method for retrieving document IDs only
router.get('/videos', async (req, res) => {
    try {
        const body = await req.elasticClient.search({
            index: process.env.ELASTICSEARCH_MAIN_INDEX,
            size: 1000,
            _source: false, // Do not retrieve the document source
            body: {
                query: {
                    match_all: {}
                }
            }
        });

        if (body.hits && body.hits.hits) {
            res.json(body.hits.hits.map(hit => hit._id));
        } else {
            throw new Error('Invalid response structure from Elasticsearch');
        }
    } catch (error) {
        console.error('Error retrieving video IDs:', error);
        res.status(500).json({ error: 'Error retrieving video IDs' });
    }
});



router.get('/videos/:videoId', async (req, res) => {
    try {
        const { videoId } = req.params;
        const videoDocument = await req.elasticClient.get({
            index: process.env.ELASTICSEARCH_MAIN_INDEX,
            id: videoId
        });

        res.json(videoDocument);
    } catch (error) {
        console.error('Error retrieving video:', error);
        res.status(500).json({ error: 'Error retrieving video' });
    }
});

router.get('/videoCount', async (req, res) => {
    console.log(`Elasticsearch URL: ${process.env.ELASTICSEARCH_URL}`);

    try {
        const response = await req.elasticClient.count({
            index: process.env.ELASTICSEARCH_MAIN_INDEX
        });


        if (response && typeof response.count === 'number') {
            res.json({ count: response.count });
        } else {
            res.status(500).json({ error: "The count property is missing from the Elasticsearch response", count: 0 });
        }
    } catch (error) {
        console.error('Error counting videos:', error);
        res.status(500).json({ error: `Error counting videos: ${error.message}` });
    }
});

router.get('/videos/videoCategory/:category', async (req, res) => {
    try {
        const { category } = req.params;

        const response = await req.elasticClient.search({
            index: process.env.ELASTICSEARCH_MAIN_INDEX,
            body: {
                query: {
                    term: {
                        videoCategory: category
                    }
                }
            }
        });

        const hits = response.hits;

        if (hits && hits.total.value > 0) {
            console.log('Videos retrieved successfully:', hits.hits.map(hit => hit._source));
            res.json(hits.hits.map(hit => hit._source));
        } else {
            console.log('No videos found for this category:', category);
            res.status(404).json({ error: 'No videos found for this category' });
        }
    } catch (error) {
        console.error('Error fetching videos:', error);
        res.status(500).json({ error: 'Error fetching videos' });
    }
});

router.get('/videos/brands/:brand', async (req, res) => {
    try {
        const { selectedBrand } = req.params;
        const brandCategory = 'brand';
        const response = await req.elasticClient.search({
            index: process.env.ELASTICSEARCH_MAIN_INDEX,
            body: {
                query: {
                    term: {
                        videoCategory: brandCategory,
                        brandName: selectedBrand
                    }
                }
            }
        });

        const hits = response.hits; // hits özelliğine doğru şekilde erişin

        if (hits && hits.total.value > 0) {
            res.json(hits.hits.map(hit => hit._source));
        } else {
            console.log('No videos found for this category:', category);
            res.status(404).json({ error: 'No videos found for this category' });
        }
    } catch (error) {
        console.error('Error fetching videos:', error);
        res.status(500).json({ error: 'Error fetching videos' });
    }
});

//Videos DELETE methods
router.delete('/videos/:videoId', async (req, res) => {
    try {
        const { videoId } = req.params;
        const response = await req.elasticClient.delete({
            index: process.env.ELASTICSEARCH_MAIN_INDEX,
            id: videoId
        });

        console.log('Delete response:', response);
        res.status(200).json({ message: 'Video deleted successfully' });
    } catch (error) {
        console.error('Error deleting video:', error);
        res.status(500).json({ error: 'Error deleting video' });
    }
});

//Videos POST methods
router.post('/videos', async (req, res) => {
    try {
        const videoData = req.body;
        console.log(videoData['videoId']);

        const response = await req.elasticClient.index({
            index: process.env.ELASTICSEARCH_MAIN_INDEX,
            body: videoData,
            id: videoData['videoId']
        });

        console.log(videoData);
        res.status(201).json({ message: 'Video and comments added successfully to Elasticsearch' });
    } catch (error) {
        console.error('Error in adding video to Elasticsearch:', error);
        res.status(500).json({ error: 'Error adding video and comments' });
    }
});


router.get('/analyze/:videoId', async (req, res) => {
    const { videoId } = req.params;

    console.log(`Attempting to fetch document for videoId: ${videoId}`);

    try {
        // Fetch comments from Elasticsearch using videoId
        const esResponse = await req.elasticClient.get({
            index: process.env.ELASTICSEARCH_MAIN_INDEX, // Ensure this is set correctly in your .env file
            id: videoId
        });

        console.log("Elasticsearch response:", esResponse);

        if (!esResponse.found) {
            console.log("Document not found for videoId:", videoId);
            return res.status(404).json({ error: 'Document not found' });
        }

        const comments = extractComments(esResponse);
        console.log("Extracted comments:", comments);

        if (!comments || comments.length === 0) {
            console.log("No valid comments extracted.");
            return res.status(404).json({ error: 'No valid comments extracted' });
        }

        console.log(`Comments extracted for videoId: ${videoId}: ${comments.length} comments found`);

        // Combine comments into a single paragraph
        const combinedComments = comments.join(' ');
        console.log('Combined comments:', combinedComments);

        // Send combined comments to the Python server for predictions
        const pyResponse = await axios.post('http://192.168.1.12:5000/predict', { text: combinedComments });
        const prediction = pyResponse.data.prediction;

        console.log('Received prediction:', prediction);

        return res.json({ videoId, prediction });
    } catch (error) {
        console.error("Error communicating with Elasticsearch or Python server:", error);
        return res.status(500).json({ error: 'Error processing the request' });
    }
});

router.get('/analyze/keyword/:keyword', async (req, res) => {
    const { keyword } = req.params;

    console.log(`Attempting to fetch comments containing keyword: ${keyword}`);

    try {
        // Search for comments containing the keyword across all videos
        const esResponse = await req.elasticClient.search({
            index: process.env.ELASTICSEARCH_MAIN_INDEX,
            size: 1000, // Adjust size if needed
            body: {
                query: {
                    bool: {
                        must: {
                            match: {
                                "comments.snippet.topLevelComment.snippet.textDisplay": keyword
                            }
                        }
                    }
                }
            }
        });

        const hits = esResponse.hits.hits;

        if (!hits.length) {
            console.log(`No comments found containing the keyword: ${keyword}`);
            return res.status(404).json({ error: 'No comments found containing the keyword' });
        }

        const comments = hits.flatMap(hit => extractKeyword(hit, keyword));
        if (comments.length === 0) {
            console.log("No valid comments extracted.");
            return res.status(404).json({ error: 'No valid comments extracted' });
        }

        console.log(`Comments extracted containing the keyword: ${keyword}: ${comments.length} comments found`);
        console.log('Extracted comments:', comments);

        // Combine comments into a single paragraph
        const combinedComments = comments.join(' ');
        console.log('Combined comments:', combinedComments);

        // Send combined comments to the Python server for predictions
        const pyResponse = await axios.post('http://127.0.0.1:5000/predict', { text: combinedComments });
        const prediction = pyResponse.data.prediction;

        console.log('Received prediction:', prediction);

        return res.json({ keyword, prediction });
    } catch (error) {
        console.error("Error communicating with Elasticsearch or Python server:", error);
        return res.status(500).json({ error: 'Error processing the request' });
    }
});

function extractComments(response) {
    if (!response._source || !response._source.comments) {
        console.log("No comments found in the response.");
        return [];
    }

    return response._source.comments.map(comment =>
        comment.snippet.topLevelComment.snippet.textDisplay
    ).filter(Boolean);
}

function extractKeyword(hit, keyword) {
    if (!hit._source || !hit._source.comments) {
        console.log("No comments found in the response.");
        return [];
    }

    return hit._source.comments
        .map(comment => comment.snippet.topLevelComment.snippet.textDisplay)
        .filter(commentText => commentText.includes(keyword));
}

module.exports = router;
