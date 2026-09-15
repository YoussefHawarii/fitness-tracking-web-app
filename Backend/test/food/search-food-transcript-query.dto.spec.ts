import { validate } from 'class-validator';
import { SearchFoodTranscriptQueryDto } from '../../src/modules/food/dto/search-food-transcript-query.dto';

describe('SearchFoodTranscriptQueryDto', () => {
  it('rejects transcripts longer than 500 characters', async () => {
    const dto = new SearchFoodTranscriptQueryDto();
    dto.transcript = 'a'.repeat(501);

    const errors = await validate(dto);

    expect(errors[0]?.constraints?.maxLength).toBeDefined();
  });
});
