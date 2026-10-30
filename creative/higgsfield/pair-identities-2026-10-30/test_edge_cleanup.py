import unittest
import numpy as np
from PIL import Image,ImageDraw
from edge_cleanup import edge_connected_white_cleanup

class ExteriorAlphaContract(unittest.TestCase):
    def test_outside_is_transparent_but_enclosed_ivory_is_unchanged(self):
        image=Image.new('RGBA',(100,140),'white');draw=ImageDraw.Draw(image)
        draw.rounded_rectangle((8,8,91,131),radius=14,fill=(20,22,24,255))
        draw.rectangle((20,22,79,45),fill=(247,242,232,255))
        draw.rectangle((20,65,79,115),fill=(247,242,232,255))
        before=np.array(image);result,report=edge_connected_white_cleanup(image);after=np.array(result)
        self.assertEqual(result.size,image.size);self.assertEqual(after[0,0,3],0)
        np.testing.assert_array_equal(before[22:46,20:80],after[22:46,20:80])
        np.testing.assert_array_equal(before[65:116,20:80],after[65:116,20:80])
        np.testing.assert_array_equal(before,np.array(image));self.assertGreater(report['removedPixels'],0)
    def test_internal_transparency_does_not_seed_paper_removal(self):
        image=Image.new('RGBA',(60,60),(15,17,19,255));draw=ImageDraw.Draw(image)
        draw.rectangle((10,10,49,49),fill=(248,245,238,255));draw.rectangle((25,25,34,34),fill=(255,255,255,0))
        before=np.array(image);after=np.array(edge_connected_white_cleanup(image)[0])
        np.testing.assert_array_equal(before,after)
    def test_colored_metal_touching_background_is_preserved(self):
        image=Image.new('RGBA',(40,40),'white');draw=ImageDraw.Draw(image)
        draw.rectangle((5,5,34,34),fill=(245,210,145,255))
        result,_=edge_connected_white_cleanup(image)
        self.assertEqual(result.getpixel((5,5)),(245,210,145,255));self.assertEqual(result.getpixel((0,0))[3],0)

if __name__=='__main__':unittest.main()
