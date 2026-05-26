const tmdb = require('./server/tmdb');

async function test() {
    console.log('==== Testing TMDB query test ====');
    
    const title = 'Breaking Bad Season 2';
    console.log('Title:', title);
    
    const si = tmdb.parseSeasonInfo(title);
    console.log('Season info:', si);
    
    const searchQ = si.season > 0 && si.base ? si.base : title;
    console.log('Search query:', searchQ);
    
    const results = await tmdb.searchMulti(searchQ);
    console.log('Results found:', results.length);
    
    let best = null;
    for (const r of results) {
        if (r.media_type !== 'movie' && r.media_type !== 'tv') continue;
        if (si.season > 0 && r.media_type === 'movie') continue;
        const names = [r.title, r.name, r.original_title, r.original_name].filter(Boolean);
        if (names.some(n => n === searchQ)) { best = r; break; }
        if (!best) best = r;
    }
    
    if (!best) {
        console.error('No results found');
        return;
    }
    
    console.log('Best:', best.name || best.title, best.id, best.media_type);
    
    const isTv = best.media_type === 'tv';
    
    let detail = null;
    try {
        detail = isTv ? await tmdb.getTvDetails(best.id) : await tmdb.getMovieDetails(best.id);
    } catch (e) {
        console.error('Detail error:', e.message);
    }
    
    const d = detail || best;
    
    let posterPath = d.poster_path;
    let seasonYear = null;
    
    if (isTv && si.season > 0) {
        try {
            console.log('Getting season', si.season, 'for', best.id);
            const season = await tmdb.getSeasonDetails(best.id, si.season);
            if (season) {
                if (season.poster_path) posterPath = season.poster_path;
                if (season.air_date) seasonYear = parseInt(season.air_date.slice(0, 4));
                else if (season.episodes && season.episodes.length > 0 && season.episodes[0].air_date) {
                    seasonYear = parseInt(season.episodes[0].air_date.slice(0, 4));
                }
                console.log('Season year from API:', seasonYear);
            }
        } catch (e) {
            console.error('Season error:', e.message);
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
    console.log('Final year:', year);
    
    const countries = d.production_countries ? d.production_countries.map(c => c.name).join(' / ') : (d.origin_country ? d.origin_country.join(' / ') : '');
    const genres = d.genres ? d.genres.map(g => g.name) : [];
    const seriesTitle = d.title || d.name || '';
    const titleEn = d.original_title || d.original_name || '';
    const tmdbRating = d.vote_average ? Math.round(d.vote_average) : 0;
    
    const tmdbUrl = `https://www.themoviedb.org/${best.media_type}/${best.id}`;
    
    console.log('\nResult:', {
        success: true,
        data: {
            seriesTitle,
            altTitle: titleEn !== seriesTitle ? titleEn : '',
            year: isNaN(year) ? 0 : year,
            countries,
            genres,
            poster: posterUrl,
            rating: tmdbRating,
            tmdbUrl
        }
    });
}

test().catch(console.error);
