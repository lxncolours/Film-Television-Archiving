const express = require('express');
const app = express();
const tmdb = require('./server/tmdb');

const COUNTRY_CN = {
    'United States': '美国',
    'United States of America': '美国',
    'USA': '美国',
};

function translateCountry(en) {
    return COUNTRY_CN[en] || en;
}

function translateCountries(str) {
    if (!str) return '';
    return str.split(' / ').map(c => translateCountry(c.trim())).join(' / ');
}

app.use(express.json());

app.post('/api/tmdb/detail', async (req, res) => {
    console.log('\n=== Request received ===');
    try {
        const { title } = req.body;
        console.log('Title:', title);
        
        const si = tmdb.parseSeasonInfo(title || '');
        console.log('Season info:', si);
        
        const searchQ = si.season > 0 && si.base ? si.base : title;
        console.log('Search query:', searchQ);
        
        const results = await tmdb.searchMulti(searchQ);
        console.log('Results:', results.length);
        
        let best = null;
        for (const r of results) {
            if (r.media_type !== 'movie' && r.media_type !== 'tv') continue;
            if (si.season > 0 && r.media_type === 'movie') continue;
            if (!best) best = r;
        }
        
        console.log('Best:', best.name || best.title, best.id);
        
        const isTv = best.media_type === 'tv';
        const detail = isTv ? await tmdb.getTvDetails(best.id) : await tmdb.getMovieDetails(best.id);
        
        const d = detail || best;
        let posterPath = d.poster_path;
        let seasonYear = null;
        
        if (isTv && si.season > 0) {
            console.log('Getting season', si.season);
            const season = await tmdb.getSeasonDetails(best.id, si.season);
            if (season) {
                if (season.poster_path) posterPath = season.poster_path;
                if (season.air_date) seasonYear = parseInt(season.air_date.slice(0, 4));
                else if (season.episodes && season.episodes.length > 0 && season.episodes[0].air_date) {
                    seasonYear = parseInt(season.episodes[0].air_date.slice(0, 4));
                }
                console.log('Season year:', seasonYear);
            }
        }
        
        const posterUrl = posterPath ? `https://image.tmdb.org/t/p/original${posterPath}` : '';
        let year = 0;
        if (seasonYear) {
            year = seasonYear;
        } else if (d.release_date) {
            year = parseInt(d.release_date.slice(0, 4));
        } else if (d.first_air_date) {
            year = parseInt(d.first_air_date.slice(0, 4));
        }
        let countries = '';
        if (d.production_countries) {
            countries = d.production_countries.map(c => c.name).join(' / ');
        } else if (d.origin_country) {
            countries = d.origin_country.join(' / ');
        }
        const countries_cn = translateCountries(countries);
        const genres = d.genres ? d.genres.map(g => g.name) : [];
        const seriesTitle = d.title || d.name || '';
        const titleEn = d.original_title || d.original_name || '';
        const tmdbRating = d.vote_average ? Math.round(d.vote_average) : 0;
        const tmdbUrl = `https://www.themoviedb.org/${best.media_type}/${best.id}`;
        
        console.log('Final year:', year);
        console.log('=== Sending response ===');
        
        res.json({
            success: true,
            data: {
                seriesTitle,
                altTitle: titleEn !== seriesTitle ? titleEn : '',
                year: isNaN(year) ? 0 : year,
                countries: countries_cn,
                genres,
                poster: posterUrl,
                rating: tmdbRating,
                tmdbUrl,
            },
        });
        
    } catch (err) {
        console.error('ERROR:', err.message);
        console.error(err.stack);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.listen(3001, () => {
    console.log('Test server running on port 3001');
});
